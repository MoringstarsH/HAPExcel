import { selectionRange } from "./selection";

export const GRID_CLIPBOARD_TYPE = "application/x-hap-grid+json";
export const GRID_CLIPBOARD_VERSION = 1;

export function parseTsv(text = "") {
  const normalized = String(text).replace(/\r\n?/g, "\n").replace(/\n$/, "");
  return normalized.split("\n").map((line) => line.split("\t"));
}

export function stringifyTsv(matrix) {
  return matrix.map((row) => row.map((value) => String(value ?? "").replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n");
}

export function createClipboardPayload(selection, rows, adapters) {
  const range = selectionRange(selection);
  if (!range) return null;
  const cells = [];
  const text = [];
  for (let row = range.top; row <= range.bottom; row += 1) {
    const cellRow = [];
    const textRow = [];
    for (let column = range.left; column <= range.right; column += 1) {
      const adapter = adapters[column];
      const raw = rows[row]?.values?.[adapter?.control?.controlId];
      const display = adapter?.display(raw) || "";
      cellRow.push({
        sourceControlId: adapter?.control?.controlId,
        sourceKind: adapter?.kind,
        raw,
        text: display
      });
      textRow.push(display);
    }
    cells.push(cellRow);
    text.push(textRow);
  }
  return { structured: JSON.stringify({ version: GRID_CLIPBOARD_VERSION, cells }), plain: stringifyTsv(text) };
}

export function readClipboardMatrix(plain, structured) {
  if (structured) {
    try {
      const parsed = JSON.parse(structured);
      if (parsed?.version === GRID_CLIPBOARD_VERSION && Array.isArray(parsed.cells) && parsed.cells.every(Array.isArray)) return parsed.cells;
    } catch (_) { /* use plain text */ }
  }
  return parseTsv(plain).map((row) => row.map((text) => ({ text, external: true })));
}

function isTextTarget(adapter) { return adapter?.kind === "text"; }
function isSpecial(kind) { return ["select", "multiSelect", "member", "relation"].includes(kind); }

export function mapClipboardCell(source, adapter) {
  if (!adapter?.writable || adapter.kind === "readonly") return { error: "此字段为只读字段" };
  if (source && !source.external) {
    if (isTextTarget(adapter)) return { value: source.text ?? "" };
    if (isSpecial(source.sourceKind)) {
      if (adapter.kind === source.sourceKind && adapter.control.controlId === source.sourceControlId) return { value: source.raw };
      return { error: source.sourceKind === adapter.kind ? "来源字段不同，请重新选择" : "粘贴内容与当前字段类型不匹配" };
    }
  }
  return adapter.parseClipboard(source?.text ?? "");
}

export function buildPasteChanges({ matrix, selection, adapters, rowCount, maxCells = 5000, maxNewRows = 200 }) {
  const range = selectionRange(selection);
  if (!range || !matrix?.length || !matrix[0]?.length) return { changes: [], errors: [], target: range };
  const single = matrix.length === 1 && matrix[0].length === 1;
  const height = single ? range.height : matrix.length;
  const width = single ? range.width : Math.max(...matrix.map((row) => row.length));
  if (height * width > maxCells) return { fatal: `粘贴已拒绝：单次最多 ${maxCells} 个单元格` };
  const requiredRows = range.top + height;
  if (Math.max(0, requiredRows - rowCount) > maxNewRows) return { fatal: `粘贴已拒绝：单次最多新增 ${maxNewRows} 行` };
  const changes = [];
  const errors = [];
  for (let rowOffset = 0; rowOffset < height; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < width; columnOffset += 1) {
      const columnIndex = range.left + columnOffset;
      if (columnIndex >= adapters.length) continue;
      const source = single ? matrix[0][0] : matrix[rowOffset]?.[columnOffset];
      if (!source) continue;
      const mapped = mapClipboardCell(source, adapters[columnIndex]);
      const change = { rowIndex: range.top + rowOffset, columnIndex, parsedValue: mapped.value, parsedError: mapped.error };
      changes.push(change);
      if (mapped.error) errors.push(change);
    }
  }
  return { changes, errors, target: { left: range.left, top: range.top, right: range.left + width - 1, bottom: range.top + height - 1, width, height } };
}
