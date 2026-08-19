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

function advancedSettingOf(control = {}) {
  const raw = control.advancedSetting;
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) { return {}; }
}

function copyValue(value) {
  if (value === null || value === undefined || typeof value !== "object") return value;
  if (typeof globalThis.structuredClone === "function") {
    try { return globalThis.structuredClone(value); } catch (_) { /* use recursive fallback */ }
  }
  if (Array.isArray(value)) return value.map(copyValue);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyValue(item)]));
}

function parseDefaultValue(value) {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text) return value;
  if (!/^[\[{]/.test(text)) return value;
  try { return JSON.parse(text); } catch (_) { return value; }
}

function isChecked(value) {
  return [true, 1, "1", "true"].includes(value);
}

function optionsOf(control = {}) {
  const options = parseDefaultValue(control.options);
  return Array.isArray(options) ? options.filter((option) => option && ![true, 1, "1", "true"].includes(option.isDeleted)) : [];
}

function optionKeyForValue(control, value) {
  const candidate = value && typeof value === "object"
    ? value.key ?? value.id ?? value.value ?? value.name
    : value;
  const option = optionsOf(control).find((item) => String(item.key) === String(candidate) || String(item.value ?? item.name ?? "") === String(candidate));
  return option?.key ?? candidate;
}

function unwrapConfiguredDefault(value) {
  const parsed = parseDefaultValue(value);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.prototype.hasOwnProperty.call(parsed, "value")) {
    return parsed.value;
  }
  if (Array.isArray(parsed) && parsed.length && parsed.every((item) => item && typeof item === "object" && Object.prototype.hasOwnProperty.call(item, "value"))) {
    const configured = parsed.find((item) => !item.source || String(item.source).toLowerCase() === "static") || parsed[0];
    return configured.value;
  }
  return parsed;
}

function normalizeDefaultValue(control, value) {
  const parsed = unwrapConfiguredDefault(value);
  if (![9, 10, 11].includes(Number(control.type))) return parsed;
  const values = Array.isArray(parsed) ? parsed : [parsed];
  return values
    .map((item) => optionKeyForValue(control, item))
    .filter((item) => item !== undefined && item !== null && String(item) !== "");
}

function definitionsOf(advanced = {}) {
  const definitions = parseDefaultValue(advanced.defsource ?? advanced.defSource);
  return Array.isArray(definitions) ? definitions : [];
}

function hasCheckedOption(control) {
  return optionsOf(control).some((option) => isChecked(option.checked));
}

function hasDefaultDefinition(control, advanced) {
  const direct = [control.defaultValue, control.defaultvalue, control.default, advanced.defaultValue, advanced.defaultvalue, advanced.default];
  return direct.some((value) => value !== undefined && value !== null)
    || definitionsOf(advanced).length > 0
    || hasCheckedOption(control);
}

function isDynamicDefaultValue(value) {
  const parsed = parseDefaultValue(value);
  if (typeof parsed === "string") return ["user-self", "user-departments", "user-role"].includes(parsed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  return Object.values(parsed).some((item) => ["user-self", "user-departments", "user-role"].includes(item));
}

function staticDefaultFromDefinition(control, advanced) {
  const definitions = definitionsOf(advanced);
  if (!definitions.length) return { hasDefault: false, value: undefined };
  const definition = definitions.find((item) => {
    if (!item || typeof item !== "object") return false;
    const fieldId = item.cid ?? item.controlId ?? item.fieldId;
    return !fieldId || String(fieldId) === String(control.controlId);
  });
  if (!definition) return { hasDefault: false, value: undefined };
  const source = String(definition.source ?? definition.sourceType ?? "static").toLowerCase();
  if (source && !["static", "value", "1"].includes(source) && definition.staticValue === undefined) {
    return { hasDefault: false, value: undefined };
  }
  const value = definition.staticValue ?? definition.value;
  if (value === undefined || value === null) return { hasDefault: false, value: undefined };
  if (definition.time === "current" || isChecked(definition.isAsync) || isDynamicDefaultValue(value)) return { hasDefault: false, value: undefined };
  return { hasDefault: true, value: normalizeDefaultValue(control, value) };
}

function checkedOptionDefault(control) {
  if (![9, 10, 11].includes(Number(control.type))) return { hasDefault: false, value: undefined };
  const checked = optionsOf(control).filter((option) => isChecked(option.checked));
  if (!checked.length) return { hasDefault: false, value: undefined };
  return { hasDefault: true, value: checked.map((option) => option.key) };
}

/**
 * HAP has returned field defaults in more than one shape over time. Keep the
 * lookup tolerant, while deliberately not treating enumDefault as a value:
 * that property controls selection cardinality for option/entity fields.
 */
export function defaultValueForControl(control = {}) {
  const advanced = advancedSettingOf(control);
  if (Object.prototype.hasOwnProperty.call(control, "value") && hasDefaultDefinition(control, advanced)) {
    return { hasDefault: true, value: copyValue(normalizeDefaultValue(control, control.value)) };
  }
  const candidates = [
    control.defaultValue,
    control.defaultvalue,
    control.default,
    advanced.defaultValue,
    advanced.defaultvalue,
    advanced.default
  ];
  // HAP includes `default: ""` on ordinary controls. Treat that transport
  // placeholder as absent so defsource/options can still supply the default.
  const value = candidates.find((candidate) => candidate !== undefined && candidate !== null && candidate !== "");
  if (value !== undefined) return { hasDefault: true, value: copyValue(normalizeDefaultValue(control, value)) };
  const staticDefault = staticDefaultFromDefinition(control, advanced);
  if (staticDefault.hasDefault) return { hasDefault: true, value: copyValue(staticDefault.value) };
  const checkedDefault = checkedOptionDefault(control);
  if (checkedDefault.hasDefault) return checkedDefault;
  return { hasDefault: false, value: undefined };
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
  const values = {};
  const dirtyFields = [];
  columns.forEach((column) => {
    const defaultValue = defaultValueForControl(column);
    values[column.controlId] = defaultValue.hasDefault ? defaultValue.value : "";
    if (defaultValue.hasDefault) dirtyFields.push(column.controlId);
  });
  return {
    key,
    rowId: null,
    serverSnapshot: {},
    values,
    dirtyFields,
    cellErrors: {},
    state: "new",
    saveError: ""
  };
}

export function isMeaningful(value) {
  return value !== "" && value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0);
}

export function hasPendingChange(row) {
  if (row.state === "deleted" || row.state === "modified" || row.state === "error" || row.state === "unknown") return true;
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
    const serverChanged = hasPendingChange(row) && JSON.stringify(row.serverSnapshot || {}) !== JSON.stringify(record || {});
    return hasPendingChange(row)
      ? { ...row, serverSnapshot: { ...record }, conflict: serverChanged || row.conflict }
      : createServerRow(record, columns);
  });
  const incoming = [...incomingById.values()].map((record) => createServerRow(record, columns));
  const newDrafts = currentRows.filter((row) => !row.rowId);
  return [...refreshedExisting, ...incoming.filter((row) => !existingById.has(row.rowId)), ...newDrafts];
}

/**
 * Replace the server portion after a new query while keeping every local draft.
 * Pending rows are deliberately placed first so a filter cannot make an edit
 * disappear from the working surface.
 */
export function mergeQueriedRows(currentRows, records, columns) {
  const pending = currentRows.filter(hasPendingChange);
  const incomingById = new Map(records.map((record) => [rowIdOf(record), record]));
  const reconciledPending = pending.map((row) => {
    const incoming = incomingById.get(row.rowId);
    if (!incoming || !row.rowId) return row;
    return { ...row, serverSnapshot: { ...incoming }, conflict: JSON.stringify(row.serverSnapshot || {}) !== JSON.stringify(incoming) || row.conflict };
  });
  const pendingIds = new Set(pending.filter((row) => row.rowId).map((row) => row.rowId));
  const serverRows = records
    .map((record) => createServerRow(record, columns))
    .filter((row) => !pendingIds.has(row.rowId));
  return [...reconciledPending, ...serverRows];
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

export function rebaseRowFromServer(row, record, columns) {
  if (!row || !record) return row;
  const serverValues = valuesFrom(record, columns);
  const dirty = new Set(row.dirtyFields || []);
  const values = { ...serverValues };
  dirty.forEach((fieldId) => { values[fieldId] = row.values[fieldId]; });
  return {
    ...row,
    rowId: row.rowId || rowIdOf(record),
    serverSnapshot: { ...record },
    values,
    state: dirty.size ? (row.rowId ? "modified" : "new") : "clean",
    saveError: ""
  };
}
