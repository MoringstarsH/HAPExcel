import { describe, expect, it } from "vitest";
import { clampColumnWidth, clampRowHeight, layoutNeedsMigration, layoutToAdvancedSetting, migrateRowHeights, normalizeLayout } from "./layout";

describe("layout helpers", () => {
  it("clamps column widths and row heights", () => {
    expect(clampColumnWidth(20)).toBe(100);
    expect(clampColumnWidth(9999)).toBe(640);
    expect(clampRowHeight(10)).toBe(28);
    expect(clampRowHeight(9999)).toBe(240);
  });

  it("keeps only fields and records present in the current view", () => {
    const view = {
      advancedSetting: JSON.stringify({ hapExcelLayout: JSON.stringify({
        columnWidths: { name: 240, removed: 300 },
        rowHeights: { row1: 60, stale: 80 }
      }) })
    };
    expect(normalizeLayout(view, [{ controlId: "name" }], ["row1"]).columnWidths).toEqual({ name: 240 });
    expect(normalizeLayout(view, [{ controlId: "name" }], ["row1"]).rowHeights).toEqual({ row1: 60 });
  });

  it("reads the legacy object layout and marks it for migration", () => {
    const view = { advancedSetting: { hapExcelLayout: { columnWidths: { name: 220 } } } };
    expect(normalizeLayout(view, [{ controlId: "name" }]).columnWidths).toEqual({ name: 220 });
    expect(layoutNeedsMigration(view)).toBe(true);
  });

  it("reads a whole advancedSetting JSON string with a legacy layout object", () => {
    const view = {
      advancedSetting: JSON.stringify({ hapExcelLayout: { defaultRowHeight: 64 } })
    };
    expect(normalizeLayout(view).defaultRowHeight).toBe(64);
    expect(layoutNeedsMigration(view)).toBe(true);
  });

  it("preserves unrelated advanced settings", () => {
    const setting = layoutToAdvancedSetting({ advancedSetting: { other: true } }, { columnWidths: { name: 200 } });
    expect(setting.other).toBe(true);
    expect(typeof setting.hapExcelLayout).toBe("string");
    expect(JSON.parse(setting.hapExcelLayout).columnWidths.name).toBe(200);
  });

  it("migrates a draft row height to the created record id", () => {
    expect(migrateRowHeights({ "draft-1": 72 }, {
      writes: [{ ok: true, item: { key: "draft-1" }, response: { data: { rowid: "row-1" } } }]
    })).toEqual({ "row-1": 72 });
  });
});
