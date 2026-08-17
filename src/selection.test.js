import { describe, expect, it } from "vitest";
import { cellsInRange, containsCell, moveSelection, selectionRange } from "./selection";

describe("selection", () => {
  it("normalizes reverse drag ranges", () => {
    const selection = { anchor: { column: 4, row: 6 }, focus: { column: 2, row: 3 } };
    expect(selectionRange(selection)).toEqual({ left: 2, right: 4, top: 3, bottom: 6, width: 3, height: 4 });
    expect(containsCell(selection, 3, 5)).toBe(true);
    expect(cellsInRange(selection)).toHaveLength(12);
  });

  it("moves or extends within bounds", () => {
    const start = { anchor: { column: 1, row: 1 }, focus: { column: 1, row: 1 } };
    expect(moveSelection(start, 1, 0, 3, 3, false).anchor).toEqual({ column: 2, row: 1 });
    expect(moveSelection(start, -4, 5, 3, 3, true)).toEqual({ anchor: start.anchor, focus: { column: 0, row: 2 } });
  });
});
