import { describe, expect, it } from "vitest";
import { virtualWindow } from "./virtualization";

describe("large data window", () => {
  it.each([500, 2000, 10000])("bounds rendered DOM rows for %i logical rows", (rowCount) => {
    const top = virtualWindow({ rowCount, scrollTop: 0, viewportHeight: 760, rowHeight: 38 });
    const middle = virtualWindow({ rowCount, scrollTop: rowCount * 19, viewportHeight: 760, rowHeight: 38 });
    const bottom = virtualWindow({ rowCount, scrollTop: rowCount * 38, viewportHeight: 760, rowHeight: 38 });
    for (const result of [top, middle, bottom]) {
      expect(result.end - result.start).toBeLessThanOrEqual(80);
      expect(result.start).toBeGreaterThanOrEqual(0);
      expect(result.end).toBeLessThanOrEqual(rowCount);
    }
  });
});
