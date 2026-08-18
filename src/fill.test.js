import { describe, expect, it } from "vitest";
import { createFieldAdapter } from "./adapters";
import { buildFillChanges, fillPreviewRange } from "./fill";

function adapter(kind, id, writable = true) {
  return {
    kind,
    writable,
    control: { controlId: id },
    display: (value) => String(value ?? ""),
    copyValue: (value) => Array.isArray(value) ? value.map((item) => ({ ...item })) : value
  };
}

function rows(values) {
  return values.map((value, index) => ({ key: `row-${index}`, rowId: `row-${index}`, state: "clean", values: { value } }));
}

describe("fill handle", () => {
  it("copies one cell downward and upward without changing the source", () => {
    const sourceRows = rows(["A", "", "", "", ""]);
    const adapters = [adapter("text", "value")];
    const down = buildFillChanges({ sourceRange: { left: 0, right: 0, top: 0, bottom: 0 }, targetRow: 3, rows: sourceRows, adapters });
    expect(down.changes.map((change) => [change.rowIndex, change.directValue])).toEqual([[1, "A"], [2, "A"], [3, "A"]]);
    const up = buildFillChanges({ sourceRange: { left: 0, right: 0, top: 3, bottom: 3 }, targetRow: 0, rows: rows(["", "", "", "D"]), adapters });
    expect(up.changes.map((change) => [change.rowIndex, change.directValue])).toEqual([[0, "D"], [1, "D"], [2, "D"]]);
  });

  it("repeats a multi-row source in its original order", () => {
    const result = buildFillChanges({
      sourceRange: { left: 0, right: 0, top: 1, bottom: 2 },
      targetRow: 6,
      rows: rows(["", "A", "B", "", "", "", ""]),
      adapters: [adapter("text", "value")]
    });
    expect(result.changes.map((change) => change.directValue)).toEqual(["A", "B", "A", "B"]);
    expect(result.targetRange).toEqual({ left: 0, right: 0, top: 1, bottom: 6, width: 1, height: 6 });
  });

  it("fills multiple columns while cycling rows independently", () => {
    const data = [
      { a: "", b: "" },
      { a: "A1", b: "B1" },
      { a: "A2", b: "B2" },
      { a: "", b: "" },
      { a: "", b: "" },
      { a: "", b: "" }
    ].map((value, index) => ({ key: `row-${index}`, rowId: `row-${index}`, state: "clean", values: value }));
    const result = buildFillChanges({
      sourceRange: { left: 0, right: 1, top: 1, bottom: 2 },
      targetRow: 5,
      rows: data,
      adapters: [adapter("text", "a"), adapter("text", "b")]
    });
    expect(result.changes.map((change) => [change.rowIndex, change.columnIndex, change.directValue])).toEqual([
      [3, 0, "A1"], [3, 1, "B1"], [4, 0, "A2"], [4, 1, "B2"], [5, 0, "A1"], [5, 1, "B1"]
    ]);
  });

  it("creates changes beyond the loaded rows without mutating rows", () => {
    const sourceRows = rows(["A"]);
    const result = buildFillChanges({
      sourceRange: { left: 0, right: 0, top: 0, bottom: 0 },
      targetRow: 3,
      rows: sourceRows,
      adapters: [adapter("text", "value")],
      maxNewRows: 3
    });
    expect(result.changes.map((change) => change.rowIndex)).toEqual([1, 2, 3]);
    expect(sourceRows).toHaveLength(1);
  });

  it("rejects limits and read-only source columns without partial changes", () => {
    const rowsData = rows(["A", "", "", ""]);
    expect(buildFillChanges({
      sourceRange: { left: 0, right: 0, top: 0, bottom: 0 },
      targetRow: 3,
      rows: rowsData,
      adapters: [adapter("text", "value")],
      maxCells: 2
    }).fatal).toContain("最多 2 个");
    expect(buildFillChanges({
      sourceRange: { left: 0, right: 0, top: 0, bottom: 0 },
      targetRow: 2,
      rows: rowsData,
      adapters: [adapter("text", "value", false)]
    }).fatal).toContain("只读");
  });

  it("deep-copies special-field values while preserving ids and labels", () => {
    const relation = [{ sid: "r-1", name: "客户 A" }];
    const relationAdapter = createFieldAdapter({ controlId: "relation", type: 29 });
    const result = buildFillChanges({
      sourceRange: { left: 0, right: 0, top: 0, bottom: 0 },
      targetRow: 1,
      rows: [{ key: "r0", rowId: "r0", state: "clean", values: { relation } }, { key: "r1", rowId: "r1", state: "clean", values: { relation: [] } }],
      adapters: [relationAdapter]
    });
    expect(result.changes[0].directValue).toEqual(relation);
    expect(result.changes[0].directValue).not.toBe(relation);
    expect(result.changes[0].directValue[0]).not.toBe(relation[0]);
    expect(result.changes[0].directValue[0].sid).toBe("r-1");
  });

  it("builds a preview range for both drag directions", () => {
    const selection = { anchor: { column: 2, row: 4 }, focus: { column: 1, row: 2 } };
    expect(fillPreviewRange(selection, 7)).toEqual({ left: 1, right: 2, top: 2, bottom: 7, width: 2, height: 6 });
    expect(fillPreviewRange(selection, 0)).toEqual({ left: 1, right: 2, top: 0, bottom: 4, width: 2, height: 5 });
  });
});
