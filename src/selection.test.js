import { describe, expect, it } from "vitest";
import { axisSelection, cellsInRange, containsCell, dragThresholdExceeded, moveSelection, selectionRange, wholeColumnSelection, wholeRowSelection } from "./selection";

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

  it("creates a complete row selection and supports reverse shift extension", () => {
    const selection = wholeRowSelection(4, 3, 6);
    expect(selection).toEqual({ anchor: { column: 0, row: 4 }, focus: { column: 2, row: 4 } });
    expect(selectionRange(wholeRowSelection(2, 3, 6, 4))).toEqual({ left: 0, right: 2, top: 2, bottom: 4, width: 3, height: 3 });
  });

  it("creates a complete column selection and handles empty or out-of-range input", () => {
    expect(wholeColumnSelection(1, 4, 5)).toEqual({ anchor: { column: 1, row: 0 }, focus: { column: 1, row: 4 } });
    expect(wholeColumnSelection(99, 4, 5, -2)).toEqual({ anchor: { column: 0, row: 0 }, focus: { column: 3, row: 4 } });
    expect(wholeRowSelection(0, 0, 5)).toBeNull();
    expect(wholeColumnSelection(0, 4, 0)).toBeNull();
  });

  it("builds anchored axis selections for row and column drags", () => {
    expect(selectionRange(axisSelection("row", 2, 6, 4, 10))).toEqual({ left: 0, right: 3, top: 2, bottom: 6, width: 4, height: 5 });
    expect(selectionRange(axisSelection("column", 3, 1, 5, 8))).toEqual({ left: 1, right: 3, top: 0, bottom: 7, width: 3, height: 8 });
    expect(axisSelection("diagonal", 0, 1, 4, 4)).toBeNull();
  });

  it("only activates axis dragging after the movement threshold", () => {
    expect(dragThresholdExceeded({ x: 10, y: 10 }, { x: 13, y: 11 }, 4)).toBe(false);
    expect(dragThresholdExceeded({ x: 10, y: 10 }, { x: 14, y: 10 }, 4)).toBe(true);
    expect(dragThresholdExceeded({ x: 10, y: 10 }, { x: 10, y: 15 })).toBe(true);
    expect(dragThresholdExceeded(null, { x: 10, y: 10 })).toBe(false);
  });
});
