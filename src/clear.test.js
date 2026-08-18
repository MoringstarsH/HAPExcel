import { describe, expect, it } from "vitest";
import { buildClearChanges } from "./clear";
import { createFieldAdapter } from "./adapters";

const selection = (anchor, focus) => ({ anchor, focus });
const row = (state = "clean") => ({ state });

describe("clear selection", () => {
  it("clears every writable cell in a rectangular selection", () => {
    const adapters = [
      createFieldAdapter({ controlId: "quantity", type: 6 }),
      createFieldAdapter({ controlId: "tags", type: 10 }),
      createFieldAdapter({ controlId: "checked", type: 36 })
    ];
    const result = buildClearChanges({
      selection: selection({ column: 0, row: 0 }, { column: 2, row: 1 }),
      rows: [row(), row()],
      adapters
    });

    expect(result.changes).toHaveLength(6);
    expect(result.changes.map((change) => change.directValue)).toEqual([
      "", [], false, "", [], false
    ]);
    expect(result.skipped).toBe(0);
  });

  it("handles reverse ranges and skips readonly or deleted cells", () => {
    const adapters = [
      createFieldAdapter({ controlId: "quantity", type: 6 }),
      createFieldAdapter({ controlId: "formula", type: 30 })
    ];
    const result = buildClearChanges({
      selection: selection({ column: 1, row: 1 }, { column: 0, row: 0 }),
      rows: [row(), row("deleted")],
      adapters
    });

    expect(result.changes).toEqual([
      { rowIndex: 0, columnIndex: 0, directValue: "" }
    ]);
    expect(result.skipped).toBe(3);
  });

  it("clears multi-select values as an empty array", () => {
    const adapter = createFieldAdapter({ controlId: "tags", type: 10 });
    expect(adapter.emptyValue()).toEqual([]);
    expect(adapter.serialize(adapter.emptyValue())).toBe("[]");
  });
});
