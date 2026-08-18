import { describe, expect, it, vi } from "vitest";

const { saveWorksheetView } = vi.hoisted(() => ({ saveWorksheetView: vi.fn() }));
vi.mock("mdye", () => ({
  api: {},
  apis: { worksheet: { saveWorksheetView } },
  md_emitter: {},
  utils: {}
}));
import { buildViewLayoutPayload, createGateway, normalizeRelationRecord, relationTitleControl } from "./gateway";

describe("relation record normalization", () => {
  const controls = [
    { controlId: "default-title", attribute: 1 },
    { controlId: "configured-title", attribute: 0 }
  ];

  it("uses showtitleid before the worksheet attribute title", () => {
    const control = { advancedSetting: { showtitleid: "configured-title" } };
    expect(relationTitleControl(control, controls)?.controlId).toBe("configured-title");
  });

  it("falls back to the worksheet attribute title", () => {
    expect(relationTitleControl({}, controls)?.controlId).toBe("default-title");
  });

  it("keeps the selected dynamic title before saving", () => {
    const record = {
      rowid: "c099989f-ca0a-48eb-9505-eb06e6dc7112",
      "default-title": "螺纹钢HPB200"
    };
    expect(normalizeRelationRecord(record, controls[0])).toEqual(expect.objectContaining({
      sid: "c099989f-ca0a-48eb-9505-eb06e6dc7112",
      name: "螺纹钢HPB200"
    }));
  });

  it("merges layout into the view without dropping other advanced settings", () => {
    const payload = buildViewLayoutPayload({
      view: { name: "台账", advancedSetting: { existing: "keep" } },
      appId: "app",
      worksheetId: "sheet",
      viewId: "view",
      layout: { columnWidths: { name: 240 }, rowHeights: { row1: 56 } }
    });
    expect(payload).toEqual(expect.objectContaining({ appId: "app", worksheetId: "sheet", viewId: "view" }));
    expect(payload.editAdKeys).toContain("hapExcelLayout");
    expect(payload.advancedSetting).toEqual(expect.objectContaining({ existing: "keep", hapExcelLayout: expect.any(String) }));
    expect(typeof payload.advancedSetting.hapExcelLayout).toBe("string");
    expect(JSON.parse(payload.advancedSetting.hapExcelLayout).columnWidths.name).toBe(240);
  });

  it("saves the layout through the worksheet API namespace", async () => {
    saveWorksheetView.mockResolvedValueOnce({ success: true });
    const gateway = createGateway({ appId: "app", worksheetId: "sheet", viewId: "view" });

    await gateway.saveViewLayout({ name: "台账" }, { columnWidths: { name: 240 } });

    expect(saveWorksheetView).toHaveBeenCalledWith(expect.objectContaining({
      appId: "app",
      worksheetId: "sheet",
      viewId: "view",
      editAdKeys: expect.arrayContaining(["hapExcelLayout"]),
      advancedSetting: expect.objectContaining({ hapExcelLayout: expect.any(String) })
    }));
    expect(JSON.parse(saveWorksheetView.mock.calls.at(-1)[0].advancedSetting.hapExcelLayout).columnWidths.name).toBe(240);
  });
});
