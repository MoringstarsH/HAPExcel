export function clampCell(cell, columnCount, rowCount) {
  return {
    column: Math.max(0, Math.min(Math.max(0, columnCount - 1), Number(cell?.column) || 0)),
    row: Math.max(0, Math.min(Math.max(0, rowCount - 1), Number(cell?.row) || 0))
  };
}

export function selectionRange(selection) {
  if (!selection?.anchor || !selection?.focus) return null;
  const left = Math.min(selection.anchor.column, selection.focus.column);
  const right = Math.max(selection.anchor.column, selection.focus.column);
  const top = Math.min(selection.anchor.row, selection.focus.row);
  const bottom = Math.max(selection.anchor.row, selection.focus.row);
  return { left, right, top, bottom, width: right - left + 1, height: bottom - top + 1 };
}

function boundedIndex(value, count) {
  return Math.max(0, Math.min(Math.max(0, count - 1), Number(value) || 0));
}

export function wholeRowSelection(rowIndex, columnCount, rowCount, anchorRow = rowIndex) {
  if (columnCount <= 0 || rowCount <= 0) return null;
  const row = boundedIndex(rowIndex, rowCount);
  const anchor = boundedIndex(anchorRow, rowCount);
  return {
    anchor: { column: 0, row: anchor },
    focus: { column: columnCount - 1, row }
  };
}

export function wholeColumnSelection(columnIndex, columnCount, rowCount, anchorColumn = columnIndex) {
  if (columnCount <= 0 || rowCount <= 0) return null;
  const column = boundedIndex(columnIndex, columnCount);
  const anchor = boundedIndex(anchorColumn, columnCount);
  return {
    anchor: { column: anchor, row: 0 },
    focus: { column, row: rowCount - 1 }
  };
}

export function axisSelection(axis, anchorIndex, focusIndex, columnCount, rowCount) {
  if (axis === "row") return wholeRowSelection(focusIndex, columnCount, rowCount, anchorIndex);
  if (axis === "column") return wholeColumnSelection(focusIndex, columnCount, rowCount, anchorIndex);
  return null;
}

export function dragThresholdExceeded(start, point, threshold = 4) {
  if (!start || !point) return false;
  return Math.hypot(Number(point.x) - Number(start.x), Number(point.y) - Number(start.y)) >= threshold;
}

export function containsCell(selection, column, row) {
  const range = selectionRange(selection);
  return Boolean(range && column >= range.left && column <= range.right && row >= range.top && row <= range.bottom);
}

export function moveSelection(selection, deltaColumn, deltaRow, columnCount, rowCount, extend = false) {
  const current = selection?.focus || { column: 0, row: 0 };
  const focus = clampCell({ column: current.column + deltaColumn, row: current.row + deltaRow }, columnCount, rowCount);
  return { anchor: extend && selection?.anchor ? selection.anchor : focus, focus };
}

export function cellsInRange(selection) {
  const range = selectionRange(selection);
  if (!range) return [];
  const result = [];
  for (let row = range.top; row <= range.bottom; row += 1) {
    for (let column = range.left; column <= range.right; column += 1) result.push({ column, row });
  }
  return result;
}
