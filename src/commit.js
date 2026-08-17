import { isMeaningful } from "./rows";

function rowIdOf(row) { return row?.rowid || row?.rowId || row?.id || null; }

function fieldsFor(row, adapters) {
  return adapters
    .filter((adapter) => adapter.writable && (
      row.dirtyFields.includes(adapter.control.controlId) ||
      (!row.rowId && isMeaningful(row.values[adapter.control.controlId]))
    ))
    .map((adapter) => ({
      controlId: adapter.control.controlId,
      type: adapter.control.type,
      value: adapter.serialize(row.values[adapter.control.controlId])
    }));
}

export function validateRows(rows, adapters) {
  const errors = new Map();
  rows.forEach((row) => {
    if (row.state === "deleted") return;
    if (!row.dirtyFields.length && row.rowId) return;
    if (!row.rowId && !row.dirtyFields.length && !Object.values(row.values).some(isMeaningful)) return;
    const cellErrors = { ...row.cellErrors };
    adapters.forEach((adapter) => {
      if (!adapter.writable) return;
      if (row.rowId && !row.dirtyFields.includes(adapter.control.controlId)) return;
      const error = adapter.validate(row.values[adapter.control.controlId], Boolean(adapter.control.required));
      if (error) cellErrors[adapter.control.controlId] = error;
      else delete cellErrors[adapter.control.controlId];
    });
    if (Object.keys(cellErrors).length) errors.set(row.key, cellErrors);
  });
  return errors;
}

async function runWorkers(items, worker, concurrency = 3) {
  const results = [];
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const item = items[cursor++];
      try { results.push({ item, ok: true, response: await worker(item) }); }
      catch (error) { results.push({ item, ok: false, error: error?.message || "保存失败" }); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, run));
  return results;
}

export async function commitRows(rows, adapters, gateway, onProgress = () => {}) {
  const validationErrors = validateRows(rows, adapters);
  if (validationErrors.size) return { validationErrors, writes: [], deletion: null, deleteSkipped: false };

  const writeRows = rows.filter((row) => row.state !== "deleted" && (
    row.dirtyFields.length || (!row.rowId && Object.values(row.values).some(isMeaningful))
  ));
  let completed = 0;
  const writes = await runWorkers(writeRows, async (row) => {
    const fields = fieldsFor(row, adapters);
    const response = row.rowId ? await gateway.update(row.rowId, fields) : await gateway.add(fields);
    completed += 1;
    onProgress({ completed, total: writeRows.length, phase: "write" });
    return response;
  });

  const failedWrites = writes.filter((result) => !result.ok);
  const deleteRows = rows.filter((row) => row.state === "deleted" && row.rowId);
  let deletion = null;
  let deleteSkipped = false;
  if (deleteRows.length) {
    if (failedWrites.length) deleteSkipped = true;
    else {
      try {
        deletion = { ok: true, rowIds: deleteRows.map((row) => row.rowId), response: await gateway.deleteRows(deleteRows.map((row) => row.rowId)) };
      } catch (error) {
        deletion = { ok: false, rowIds: deleteRows.map((row) => row.rowId), error: error?.message || "删除失败" };
      }
      onProgress({ completed: deleteRows.length, total: deleteRows.length, phase: "delete" });
    }
  }
  return { validationErrors, writes, deletion, deleteSkipped };
}

export function applyCommitResult(rows, result) {
  if (result.validationErrors?.size) {
    return rows.map((row) => result.validationErrors.has(row.key)
      ? { ...row, cellErrors: result.validationErrors.get(row.key), state: "error", saveError: "请修正字段错误" }
      : row);
  }
  const writesByKey = new Map(result.writes.map((entry) => [entry.item.key, entry]));
  const deleted = result.deletion?.ok ? new Set(result.deletion.rowIds) : new Set();
  return rows.filter((row) => !deleted.has(row.rowId)).map((row) => {
    const write = writesByKey.get(row.key);
    if (write?.ok) {
      const data = write.response?.data || write.response || {};
      return {
        ...row,
        rowId: row.rowId || rowIdOf(data),
        serverSnapshot: { ...row.serverSnapshot, ...row.values, ...data },
        dirtyFields: [],
        cellErrors: {},
        state: "clean",
        saveError: ""
      };
    }
    if (write && !write.ok) return { ...row, state: "error", saveError: write.error };
    if (row.state === "deleted" && result.deletion && !result.deletion.ok) return { ...row, state: "deleted", saveError: result.deletion.error };
    return row;
  });
}
