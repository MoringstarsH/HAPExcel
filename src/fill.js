import { selectionRange } from "./selection";

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function cellKey(rowIndex, columnIndex) {
  return `${rowIndex}:${columnIndex}`;
}

function isInsideRange(range, rowIndex) {
  return rowIndex >= range.top && rowIndex <= range.bottom;
}

function validRange(sourceRange) {
  return sourceRange && Number.isFinite(sourceRange.left) && Number.isFinite(sourceRange.right)
    && Number.isFinite(sourceRange.top) && Number.isFinite(sourceRange.bottom)
    && sourceRange.left <= sourceRange.right && sourceRange.top <= sourceRange.bottom;
}

/**
 * Build the values that a vertical fill-handle drag should copy.
 * The source range is never rewritten; rows outside it repeat the source
 * range from top to bottom, regardless of drag direction.
 */
export function buildFillChanges({
  sourceRange,
  targetRow,
  rows = [],
  adapters = [],
  maxCells = 5000,
  maxNewRows = 200
} = {}) {
  if (!validRange(sourceRange)) return { changes: [], targetRange: null, previewValues: [], errors: [], fatal: "无法确定填充源范围" };

  const range = {
    left: integer(sourceRange.left),
    right: integer(sourceRange.right),
    top: integer(sourceRange.top),
    bottom: integer(sourceRange.bottom)
  };
  const requestedRow = integer(targetRow, range.bottom);
  const targetTop = Math.min(range.top, requestedRow);
  const targetBottom = Math.max(range.bottom, requestedRow);
  const targetRange = {
    left: range.left,
    right: range.right,
    top: targetTop,
    bottom: targetBottom,
    width: range.right - range.left + 1,
    height: targetBottom - targetTop + 1
  };

  const sourceRows = range.bottom - range.top + 1;
  const targetRowsOutsideSource = Math.max(0, targetRange.height - sourceRows);
  const totalCells = targetRowsOutsideSource * targetRange.width;
  if (totalCells > maxCells) {
    return { changes: [], targetRange, previewValues: [], errors: [], fatal: `填充已拒绝：单次最多 ${maxCells} 个单元格` };
  }

  const requiredRows = targetBottom + 1;
  const newRows = Math.max(0, requiredRows - rows.length);
  if (newRows > maxNewRows) {
    return { changes: [], targetRange, previewValues: [], errors: [], fatal: `填充已拒绝：单次最多新增 ${maxNewRows} 行` };
  }

  const sourceAdapters = adapters.slice(range.left, range.right + 1);
  if (sourceAdapters.some((adapter) => !adapter?.writable || adapter.kind === "readonly")) {
    return { changes: [], targetRange, previewValues: [], errors: [], fatal: "选区包含只读字段，无法拖拽填充" };
  }
  if (Array.from({ length: sourceRows }, (_, offset) => rows[range.top + offset]).some((row) => !row || row.state === "deleted")) {
    return { changes: [], targetRange, previewValues: [], errors: [], fatal: "已删除行不能作为填充源" };
  }

  const changes = [];
  const previewValues = [];
  const errors = [];
  for (let rowIndex = targetTop; rowIndex <= targetBottom; rowIndex += 1) {
    if (isInsideRange(range, rowIndex)) continue;
    const sourceRowIndex = range.top + ((rowIndex - targetTop) % sourceRows);
    const targetRowData = rows[rowIndex];
    for (let columnIndex = range.left; columnIndex <= range.right; columnIndex += 1) {
      const adapter = adapters[columnIndex];
      const sourceFieldId = adapter?.control?.controlId;
      const sourceValue = rows[sourceRowIndex]?.values?.[sourceFieldId];
      if (!adapter?.writable || adapter.kind === "readonly") {
        errors.push({ rowIndex, columnIndex, error: "此字段为只读字段" });
        continue;
      }
      if (targetRowData?.state === "deleted") {
        errors.push({ rowIndex, columnIndex, error: "已删除行不能填充" });
        continue;
      }
      const value = adapter.copyValue ? adapter.copyValue(sourceValue) : sourceValue;
      const preview = {
        rowIndex,
        columnIndex,
        sourceRowIndex,
        sourceColumnIndex: columnIndex,
        value,
        display: adapter.display(value)
      };
      previewValues.push(preview);
      changes.push({ rowIndex, columnIndex, directValue: value, sourceRowIndex, sourceColumnIndex: columnIndex });
    }
  }

  return { changes, targetRange, previewValues, errors, fatal: "" };
}

export function fillPreviewRange(sourceSelection, targetRow) {
  const range = selectionRange(sourceSelection);
  if (!range || !Number.isFinite(Number(targetRow))) return null;
  const row = integer(targetRow);
  return {
    left: range.left,
    right: range.right,
    top: Math.min(range.top, row),
    bottom: Math.max(range.bottom, row),
    width: range.width,
    height: Math.max(range.bottom, row) - Math.min(range.top, row) + 1
  };
}

export function fillPreviewMap(previewValues = []) {
  return new Map(previewValues.map((item) => [cellKey(item.rowIndex, item.columnIndex), item]));
}
