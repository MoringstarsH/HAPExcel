import { describe, expect, it } from "vitest";
import { createFieldAdapter } from "./adapters";
import { buildReplaceChanges, buildValueChanges, filteredRowIndexes, targetRowsForColumn } from "./batch";

const rows = [
  { rowId: "r1", state: "clean", values: { name: "钢筋 A", amount: 10 } },
  { rowId: "r2", state: "clean", values: { name: "钢筋 B", amount: 20 } },
  { rowId: "r3", state: "deleted", values: { name: "钢筋 C", amount: 30 } }
];

describe("batch operations", () => {
  it("finds writable rows in the focus column", () => {
    const adapters = [createFieldAdapter({ controlId: "name", type: 2 })];
    expect(targetRowsForColumn({ anchor: { column: 0, row: 0 }, focus: { column: 0, row: 2 } }, 0, rows, adapters)).toEqual({ rowIndexes: [0, 1], skipped: 1 });
  });

  it("builds deep-copied value changes", () => {
    const adapter = createFieldAdapter({ controlId: "name", type: 2 });
    const result = buildValueChanges({ rowIndexes: [0, 1], columnIndex: 0, value: "统一", adapters: [adapter] });
    expect(result.changes).toHaveLength(2);
    expect(result.changes[0].directValue).toBe("统一");
  });

  it("replaces text and reports structured-field rejection", () => {
    const text = createFieldAdapter({ controlId: "name", type: 2 });
    const result = buildReplaceChanges({ rows, rowIndexes: [0, 1], columnIndex: 0, adapters: [text], find: "钢筋", replacement: "螺纹钢" });
    expect(result.changes.map((change) => change.parsedValue)).toEqual(["螺纹钢 A", "螺纹钢 B"]);
    const select = createFieldAdapter({ controlId: "name", type: 10 });
    expect(buildReplaceChanges({ rows, rowIndexes: [0], columnIndex: 0, adapters: [select], find: "A", replacement: "B" }).fatal).toContain("批量设置");
  });

  it("filters only persisted rows matching the current filter map", () => {
    const adapter = createFieldAdapter({ controlId: "name", type: 2 });
    expect(filteredRowIndexes(rows, { name: { operator: "contains", value: "B" } }, [{ controlId: "name", type: 2 }], [adapter])).toEqual([1]);
  });
});
