import { selectionRange } from "./selection";

export function targetRowsForColumn(selection, columnIndex, rows = [], adapters = []) {
  const range = selectionRange(selection);
  const adapter = adapters[columnIndex];
  if (!range || !adapter) return { rowIndexes: [], skipped: 0 };
  const rowIndexes = [];
  let skipped = 0;
  for (let rowIndex = range.top; rowIndex <= range.bottom; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row || row.state === "deleted" || !adapter.writable) skipped += 1;
    else rowIndexes.push(rowIndex);
  }
  return { rowIndexes, skipped };
}

export function buildValueChanges({ rowIndexes = [], columnIndex, value, adapters = [], copyValue = true }) {
  const adapter = adapters[columnIndex];
  if (!adapter?.writable) return { changes: [], skipped: rowIndexes.length, errors: [] };
  const changes = rowIndexes.map((rowIndex) => ({
    rowIndex,
    columnIndex,
    directValue: copyValue && adapter.copyValue ? adapter.copyValue(value) : value
  }));
  return { changes, skipped: 0, errors: [] };
}

function matchesText(adapter, raw, find, replacement) {
  const current = String(adapter.display(raw) ?? "");
  if (!find || !current.toLocaleLowerCase().includes(String(find).toLocaleLowerCase())) return null;
  if (["number", "date", "datetime", "time"].includes(adapter.kind)) {
    if (current !== String(find)) return null;
    return adapter.parseEditor(replacement);
  }
  return adapter.parseEditor(current.split(String(find)).join(String(replacement)));
}

export function buildReplaceChanges({ rows = [], rowIndexes = [], columnIndex, adapters = [], find = "", replacement = "" }) {
  const adapter = adapters[columnIndex];
  const changes = [];
  const errors = [];
  let skipped = 0;
  if (!adapter?.writable || !find) return { changes, errors, skipped: rowIndexes.length, fatal: !find ? "请输入查找内容" : "字段不可编辑" };
  if (["select", "multiSelect", "member", "department", "appRole", "orgRole", "relation", "location"].includes(adapter.kind)) {
    return { changes, errors, skipped: rowIndexes.length, fatal: "选项、成员和关联字段请使用批量设置" };
  }
  rowIndexes.forEach((rowIndex) => {
    const row = rows[rowIndex];
    const fieldId = adapter.control.controlId;
    const parsed = matchesText(adapter, row?.values?.[fieldId], find, replacement);
    if (!parsed) { skipped += 1; return; }
    const change = { rowIndex, columnIndex, parsedValue: parsed.value, parsedError: parsed.error };
    changes.push(change);
    if (parsed.error) errors.push(change);
  });
  return { changes, errors, skipped, fatal: "" };
}

function filterValue(raw, adapter) {
  if (adapter?.kind === "select" || adapter?.kind === "multiSelect") return adapter.optionTags(raw).map((item) => item.key);
  return raw === null || raw === undefined ? "" : String(raw);
}

export function rowMatchesFilters(row, filterMap = {}, controls = [], adapters = []) {
  return Object.entries(filterMap).every(([fieldId, filter]) => {
    const index = controls.findIndex((control) => control.controlId === fieldId);
    const adapter = adapters[index];
    if (!adapter) return true;
    const raw = row?.values?.[fieldId];
    const value = filterValue(raw, adapter);
    const operator = filter?.operator || "contains";
    const target = filter?.value;
    const targetText = Array.isArray(target) ? target.map(String) : String(target ?? "");
    if (operator === "empty") return adapter.isEmpty ? adapter.isEmpty(raw) : value === "";
    if (operator === "notEmpty") return !(adapter.isEmpty ? adapter.isEmpty(raw) : value === "");
    if (operator === "equals") return Array.isArray(value) ? targetText.some((item) => value.includes(item)) : value === targetText;
    if (operator === "notEquals") return Array.isArray(value) ? !targetText.some((item) => value.includes(item)) : value !== targetText;
    if (operator === "greaterThan") return Number(raw) > Number(target);
    if (operator === "lessThan") return Number(raw) < Number(target);
    if (operator === "greaterOrEqual") return Number(raw) >= Number(target);
    if (operator === "lessOrEqual") return Number(raw) <= Number(target);
    if (operator === "startsWith") return String(value).startsWith(targetText);
    if (operator === "endsWith") return String(value).endsWith(targetText);
    if (operator === "notContains") return !String(value).toLocaleLowerCase().includes(targetText.toLocaleLowerCase());
    return String(value).toLocaleLowerCase().includes(targetText.toLocaleLowerCase());
  });
}

export function filteredRowIndexes(rows = [], filterMap = {}, controls = [], adapters = []) {
  return rows.map((row, rowIndex) => row?.rowId && rowMatchesFilters(row, filterMap, controls, adapters) ? rowIndex : -1).filter((rowIndex) => rowIndex >= 0);
}
