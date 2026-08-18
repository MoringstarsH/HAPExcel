import { cellsInRange } from "./selection";

export function buildClearChanges({ selection, rows = [], adapters = [] }) {
  const changes = [];
  let skipped = 0;

  cellsInRange(selection).forEach(({ column, row }) => {
    const targetRow = rows[row];
    const adapter = adapters[column];
    if (!targetRow || !adapter || !adapter.writable || targetRow.state === "deleted") {
      skipped += 1;
      return;
    }
    changes.push({
      rowIndex: row,
      columnIndex: column,
      directValue: adapter.emptyValue()
    });
  });

  return { changes, skipped };
}
