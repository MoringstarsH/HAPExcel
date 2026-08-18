import { isMeaningful } from "./rows";

function rowIdOf(row) { return row?.rowid || row?.rowId || row?.id || null; }
function normalized(response, operation) {
  if (response && typeof response.ok === "boolean" && response.outcome) return response;
  return { ok: true, operation, outcome: "success", rowId: rowIdOf(response?.data || response), details: response, message: "" };
}

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
      const fieldId = adapter.control.controlId;
      const existingError = cellErrors[fieldId];
      const error = adapter.validate(row.values[fieldId], Boolean(adapter.control.required));
      if (error) cellErrors[fieldId] = error;
      else if (!existingError) delete cellErrors[fieldId];
    });
    if (Object.keys(cellErrors).length) errors.set(row.key, cellErrors);
  });
  return errors;
}

export function normalizeOptionalFieldErrors(rows, adapters) {
  return rows.map((row) => {
    if (row.state === "deleted") return row;
    let values = row.values;
    let cellErrors = row.cellErrors;
    adapters.forEach((adapter) => {
      const fieldId = adapter.control.controlId;
      if (!adapter.writable || adapter.control.required) return;
      if (row.rowId && !row.dirtyFields.includes(fieldId)) return;
      const error = cellErrors?.[fieldId] || adapter.validate(values?.[fieldId], false);
      if (!error) return;
      values = values === row.values ? { ...values } : values;
      cellErrors = cellErrors === row.cellErrors ? { ...cellErrors } : cellErrors;
      values[fieldId] = "";
      delete cellErrors[fieldId];
    });
    return values === row.values && cellErrors === row.cellErrors ? row : { ...row, values, cellErrors };
  });
}

async function runWorkers(items, worker, concurrency = 3) {
  const results = [];
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const item = items[cursor++];
      try {
        const response = await worker(item);
        results.push({ item, ...response, response });
      } catch (error) { results.push({ item, ok: false, outcome: "failed", code: error?.code || "REQUEST_ERROR", error: error?.message || "保存失败", message: error?.message || "保存失败" }); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, run));
  return results;
}

export async function commitRows(rows, adapters, gateway, onProgress = () => {}) {
  const preparedRows = normalizeOptionalFieldErrors(rows, adapters);
  const validationErrors = validateRows(preparedRows, adapters);
  if (validationErrors.size) return { validationErrors, writes: [], deletion: null, deleteSkipped: false };

  const writeRows = preparedRows.filter((row) => row.state !== "deleted" && (
    row.dirtyFields.length || (!row.rowId && Object.values(row.values).some(isMeaningful))
  ));
  let completed = 0;
  const writes = await runWorkers(writeRows, async (row) => {
    const fields = fieldsFor(row, adapters);
    const operation = row.rowId ? "update" : "add";
    const response = normalized(row.rowId ? await gateway.update(row.rowId, fields) : await gateway.add(fields), operation);
    completed += 1;
    onProgress({ completed, total: writeRows.length, phase: "write" });
    return response;
  });

  const failedWrites = writes.filter((result) => !result.ok);
  const deleteRows = preparedRows.filter((row) => row.state === "deleted" && row.rowId);
  let deletion = null;
  let deleteSkipped = false;
  if (deleteRows.length) {
    if (failedWrites.length) deleteSkipped = true;
    else {
      try {
        const response = normalized(await gateway.deleteRows(deleteRows.map((row) => row.rowId)), "delete");
        deletion = { ...response, rowIds: deleteRows.map((row) => row.rowId), response };
      } catch (error) {
        deletion = { ok: false, outcome: "failed", rowIds: deleteRows.map((row) => row.rowId), error: error?.message || "删除失败", message: error?.message || "删除失败" };
      }
      onProgress({ completed: deleteRows.length, total: deleteRows.length, phase: "delete" });
    }
  }
  return { validationErrors, writes, deletion, deleteSkipped, deleteRowIds: deleteRows.map((row) => row.rowId) };
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
      const data = write.response?.details?.data || write.response?.details || write.response?.data || write.response || {};
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
    if (write && !write.ok) return {
      ...row,
      state: write.outcome === "unknown" ? "unknown" : "error",
      saveError: write.message || write.error || "保存失败",
      saveDetails: { operation: write.operation, code: write.code, outcome: write.outcome, retryable: write.retryable }
    };
    if (row.state === "deleted" && result.deletion && !result.deletion.ok) return {
      ...row,
      state: "deleted",
      saveError: result.deletion.message || result.deletion.error || "删除失败",
      saveDetails: { operation: "delete", code: result.deletion.code, outcome: result.deletion.outcome, retryable: result.deletion.retryable }
    };
    return row;
  });
}

export function commitSummary(result) {
  const summary = { add: { success: 0, failed: 0, unknown: 0 }, update: { success: 0, failed: 0, unknown: 0 }, delete: { success: 0, failed: 0, skipped: 0 } };
  result.writes.forEach((entry) => {
    const target = summary[entry.operation || (entry.item.rowId ? "update" : "add")];
    if (entry.ok) target.success += 1;
    else if (entry.outcome === "unknown") target.unknown += 1;
    else target.failed += 1;
  });
  if (result.deleteSkipped) summary.delete.skipped = result.deleteRowIds?.length || 0;
  else if (result.deletion?.ok) summary.delete.success = result.deletion.rowIds.length;
  else if (result.deletion) summary.delete.failed = result.deletion.rowIds.length;
  return summary;
}
