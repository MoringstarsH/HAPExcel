let temporarySequence = 0;

function rowIdOf(row) { return row?.rowid || row?.rowId || row?.id || null; }

function temporaryId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  temporarySequence += 1;
  return `temp-${Date.now()}-${temporarySequence}`;
}

export function valuesFrom(record, columns) {
  return Object.fromEntries(columns.map((column) => [column.controlId, record?.[column.controlId] ?? ""]));
}

export function createServerRow(record, columns) {
  const rowId = rowIdOf(record);
  return {
    key: rowId || temporaryId(),
    rowId,
    serverSnapshot: { ...record },
    values: valuesFrom(record, columns),
    dirtyFields: [],
    cellErrors: {},
    state: "clean",
    saveError: ""
  };
}

export function createDraftRow(columns) {
  const key = temporaryId();
  return {
    key,
    rowId: null,
    serverSnapshot: {},
    values: valuesFrom({}, columns),
    dirtyFields: [],
    cellErrors: {},
    state: "new",
    saveError: ""
  };
}

export function isMeaningful(value) {
  return value !== "" && value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0);
}

export function hasPendingChange(row) {
  if (row.state === "deleted" || row.state === "modified" || row.state === "error") return true;
  if (row.state === "new") return row.dirtyFields.length > 0 || Object.values(row.values).some(isMeaningful);
  return row.dirtyFields.length > 0;
}

export function editRow(row, fieldId, value, error) {
  const cellErrors = { ...row.cellErrors };
  if (error) cellErrors[fieldId] = error;
  else delete cellErrors[fieldId];
  const dirtyFields = row.dirtyFields.includes(fieldId) ? row.dirtyFields : [...row.dirtyFields, fieldId];
  return {
    ...row,
    values: error ? row.values : { ...row.values, [fieldId]: value },
    dirtyFields,
    cellErrors,
    state: row.rowId ? "modified" : "new",
    saveError: ""
  };
}

export function markDeleted(row) {
  return row.rowId ? { ...row, state: "deleted", saveError: "" } : null;
}

export function restoreDeleted(row) {
  if (!row.rowId) return row;
  return { ...row, state: row.dirtyFields.length ? "modified" : "clean", saveError: "" };
}

export function mergeServerPage(currentRows, records, columns) {
  const existingById = new Map(currentRows.filter((row) => row.rowId).map((row) => [row.rowId, row]));
  const incomingById = new Map();
  for (const record of records) {
    const rowId = rowIdOf(record);
    if (rowId) incomingById.set(rowId, record);
  }
  const refreshedExisting = currentRows.filter((row) => row.rowId).map((row) => {
    const record = incomingById.get(row.rowId);
    if (!record) return row;
    incomingById.delete(row.rowId);
    return hasPendingChange(row)
      ? { ...row, serverSnapshot: { ...record } }
      : createServerRow(record, columns);
  });
  const incoming = [...incomingById.values()].map((record) => createServerRow(record, columns));
  const newDrafts = currentRows.filter((row) => !row.rowId);
  return [...refreshedExisting, ...incoming.filter((row) => !existingById.has(row.rowId)), ...newDrafts];
}

export function mergeRestoredDrafts(serverRows, draftRows, columns) {
  const draftById = new Map(draftRows.filter((row) => row.rowId).map((row) => [row.rowId, row]));
  const merged = serverRows.map((row) => {
    const draft = draftById.get(row.rowId);
    if (!draft) return row;
    return {
      ...row,
      ...draft,
      serverSnapshot: row.serverSnapshot,
      values: { ...row.values, ...draft.values }
    };
  });
  const loadedIds = new Set(serverRows.map((row) => row.rowId));
  draftRows.filter((row) => !row.rowId || !loadedIds.has(row.rowId)).forEach((row) => {
    merged.push({
      ...createDraftRow(columns),
      ...row,
      values: { ...valuesFrom({}, columns), ...row.values }
    });
  });
  return merged;
}
