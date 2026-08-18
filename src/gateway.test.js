import { describe, expect, it, vi } from "vitest";

vi.mock("mdye", () => ({ api: {}, md_emitter: {}, utils: {} }));
import { normalizeRelationRecord, relationTitleControl } from "./gateway";

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
});
