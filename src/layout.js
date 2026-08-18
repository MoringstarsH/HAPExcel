export const LAYOUT_NAMESPACE = "hapExcelLayout";
export const ROW_MARKER_WIDTH = 48;
export const MIN_COLUMN_WIDTH = 48;
export const MAX_COLUMN_WIDTH = 640;
export const MIN_ROW_HEIGHT = 28;
export const MAX_ROW_HEIGHT = 240;
export const DEFAULT_ROW_HEIGHT = 44;

function numberInRange(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

export function clampColumnWidth(value, fallback = 160) {
  return numberInRange(value, fallback, MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH);
}

export function gridWidthOf(columns = [], rowMarkerWidth = ROW_MARKER_WIDTH) {
  const markerWidth = Number(rowMarkerWidth);
  return (Number.isFinite(markerWidth) ? Math.max(0, markerWidth) : ROW_MARKER_WIDTH)
    + (Array.isArray(columns) ? columns : []).reduce((total, column) => {
      const width = Number(column?.width);
      return total + (Number.isFinite(width) ? Math.max(0, width) : 0);
    }, 0);
}

export function clampRowHeight(value, fallback = DEFAULT_ROW_HEIGHT) {
  return numberInRange(value, fallback, MIN_ROW_HEIGHT, MAX_ROW_HEIGHT);
}

function parseAdvancedSetting(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) { return {}; }
}

function rawLayoutValueOf(view = {}) {
  const advanced = parseAdvancedSetting(view.advancedSetting);
  return advanced[LAYOUT_NAMESPACE] !== undefined
    ? advanced[LAYOUT_NAMESPACE]
    : view[LAYOUT_NAMESPACE];
}

function rawLayoutOf(view = {}) {
  return parseAdvancedSetting(rawLayoutValueOf(view));
}

export function layoutNeedsMigration(view = {}) {
  const value = rawLayoutValueOf(view);
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function normalizeLayout(view = {}, controls = [], validRowKeys = []) {
  const raw = rawLayoutOf(view);
  const fieldIds = new Set(controls.map((control) => control.controlId));
  const validKeys = new Set(validRowKeys.filter(Boolean));
  const columnWidths = Object.fromEntries(Object.entries(raw.columnWidths || {})
    .filter(([fieldId]) => fieldIds.has(fieldId))
    .map(([fieldId, width]) => [fieldId, clampColumnWidth(width)]));
  const rowHeights = Object.fromEntries(Object.entries(raw.rowHeights || {})
    .filter(([rowKey]) => !validKeys.size || validKeys.has(rowKey))
    .map(([rowKey, height]) => [rowKey, clampRowHeight(height)]));
  return {
    version: 1,
    columnWidths,
    defaultRowHeight: clampRowHeight(raw.defaultRowHeight, DEFAULT_ROW_HEIGHT),
    rowHeights
  };
}

export function layoutToAdvancedSetting(view = {}, layout = {}) {
  const advanced = parseAdvancedSetting(view.advancedSetting);
  const normalized = {
    version: 1,
    columnWidths: { ...(layout.columnWidths || {}) },
    defaultRowHeight: clampRowHeight(layout.defaultRowHeight),
    rowHeights: { ...(layout.rowHeights || {}) }
  };
  return {
    ...advanced,
    [LAYOUT_NAMESPACE]: JSON.stringify(normalized)
  };
}

export function compactLayout(layout = {}, controls = [], validRowKeys = []) {
  const normalized = normalizeLayout({ advancedSetting: { [LAYOUT_NAMESPACE]: layout } }, controls, validRowKeys);
  return normalized;
}

export function migrateRowHeights(rowHeights = {}, result = {}) {
  const next = { ...rowHeights };
  (result.writes || []).forEach((entry) => {
    if (!entry?.ok || !entry.item?.key || !next[entry.item.key]) return;
    const data = entry.response?.data || entry.response || {};
    const rowId = data.rowid || data.rowId || data.id;
    if (!rowId) return;
    next[rowId] = next[entry.item.key];
    delete next[entry.item.key];
  });
  return next;
}
