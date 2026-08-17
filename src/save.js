export async function saveDraftRows(rows, adapters, gateway, onProgress = () => {}) {
  const writable = (adapter) => !adapter.control.readonly && !adapter.control.disabled && ![14, 21, 22, 25, 30, 31, 32, 33, 34, 35, 37, 38, 39, 40, 41, 42, 43, 44, 45, 47, 48].includes(Number(adapter.control.type));
  const meaningful = (value) => value !== "" && value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0);
  const queue = rows.filter((row) => row.isNew || row.dirtyFields?.length).map((row) => ({ row, snapshot: structuredClone(row) }));
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < queue.length) {
      const item = queue[cursor++];
      const { row, snapshot } = item;
      const errors = {};
      adapters.forEach((adapter) => {
        if (!writable(adapter) || (!row.dirtyFields?.includes(adapter.control.controlId) && !row.isNew)) return;
        const value = row.values[adapter.control.controlId];
        const error = adapter.validate(value, Boolean(adapter.control.required));
        if (error) errors[adapter.control.controlId] = error;
      });
      if (Object.keys(errors).length) { results.push({ key: row.key, ok: false, errors, error: "请先修正字段错误" }); onProgress(); continue; }
      const fields = adapters.filter((adapter) => writable(adapter) && (row.dirtyFields.includes(adapter.control.controlId) || (row.isNew && meaningful(row.values[adapter.control.controlId])))).map((adapter) => ({ controlId: adapter.control.controlId, type: adapter.control.type, value: adapter.serialize(row.values[adapter.control.controlId]) }));
      try {
        const response = row.isNew ? await gateway.add(fields) : await gateway.update(row.rowId, fields);
        results.push({ key: row.key, ok: true, row: response?.data || response, snapshot });
      } catch (error) { results.push({ key: row.key, ok: false, error: error?.message || "保存失败" }); }
      onProgress();
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  return results;
}
