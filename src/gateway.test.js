import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveWorksheetView: vi.fn(),
  getRowDetail: vi.fn(),
  selectDepartments: vi.fn(),
  selectOrgRole: vi.fn(),
  selectLocation: vi.fn(),
  openRecordInfo: vi.fn()
}));
vi.mock("mdye", () => ({
  api: { getRowDetail: mocks.getRowDetail },
  apis: { worksheet: { saveWorksheetView: mocks.saveWorksheetView } },
  md_emitter: {},
  utils: { selectDepartments: mocks.selectDepartments, selectOrgRole: mocks.selectOrgRole, selectLocation: mocks.selectLocation, openRecordInfo: mocks.openRecordInfo }
}));
import { buildViewLayoutPayload, createGateway, isBusinessFailure, normalizeMutation, normalizeRelationRecord, relationTitleControl, withRetry } from "./gateway";

describe("gateway reliability", () => {
  it("normalizes resolved business failures", () => {
    expect(isBusinessFailure({ success: false, errorCode: 7 })).toBe(true);
    expect(normalizeMutation("update", { success: false, errorCode: 7, message: "无权限" })).toMatchObject({ ok: false, outcome: "failed", code: 7, message: "无权限" });
    expect(normalizeMutation("add", { data: { rowid: "new-1" } })).toMatchObject({ ok: true, outcome: "success", rowId: "new-1" });
  });

  it("retries transient reads with bounded backoff", async () => {
    let calls = 0;
    const value = await withRetry(async () => { calls += 1; if (calls < 3) throw new TypeError("Failed to fetch"); return "ok"; }, { attempts: 3, delay: 0 });
    expect(value).toBe("ok");
    expect(calls).toBe(3);
  });
});

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
    mocks.saveWorksheetView.mockResolvedValueOnce({ success: true });
    const gateway = createGateway({ appId: "app", worksheetId: "sheet", viewId: "view" });

    await gateway.saveViewLayout({ name: "台账" }, { columnWidths: { name: 240 } });

    expect(mocks.saveWorksheetView).toHaveBeenCalledWith(expect.objectContaining({
      appId: "app",
      worksheetId: "sheet",
      viewId: "view",
      editAdKeys: expect.arrayContaining(["hapExcelLayout"]),
      advancedSetting: expect.objectContaining({ hapExcelLayout: expect.any(String) })
    }));
    expect(JSON.parse(mocks.saveWorksheetView.mock.calls.at(-1)[0].advancedSetting.hapExcelLayout).columnWidths.name).toBe(240);
  });
  it("wraps public HAP selectors and record refresh APIs", async () => {
    mocks.selectDepartments.mockResolvedValueOnce([{ departmentId: "d1" }]);
    mocks.selectOrgRole.mockResolvedValueOnce([{ organizeId: "r1" }]);
    mocks.selectLocation.mockResolvedValueOnce([{ name: "仓库", lat: "31", lng: "121" }]);
    mocks.getRowDetail.mockResolvedValueOnce({ data: { rowid: "row1", formula: 3 } });
    mocks.openRecordInfo.mockResolvedValueOnce({ action: "update" });
    const gateway = createGateway({ appId: "app", worksheetId: "sheet", viewId: "view" });
    await expect(gateway.selectDepartments({ enumDefault: 1 })).resolves.toEqual([{ departmentId: "d1" }]);
    await expect(gateway.selectOrgRoles({ enumDefault: 2 })).resolves.toEqual([{ organizeId: "r1" }]);
    await expect(gateway.selectLocation({}, null)).resolves.toEqual({ name: "仓库", lat: "31", lng: "121" });
    await expect(gateway.loadRowDetail("row1")).resolves.toEqual({ rowid: "row1", formula: 3 });
    await gateway.openCurrentRecord("row1");
    expect(mocks.openRecordInfo).toHaveBeenCalledWith({ appId: "app", worksheetId: "sheet", viewId: "view", recordId: "row1" });
  });
});
