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
