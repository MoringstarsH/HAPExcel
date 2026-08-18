import { describe, expect, it } from "vitest";
import { hiddenErrorFieldNames, resolveVisibleControls } from "./columns";

const controls = [
  { controlId: "arrival", controlName: "到货日期", type: 15 },
  { controlId: "material", controlName: "原料名称", type: 29 },
  { controlId: "amount", controlName: "进场数量", type: 6 },
  { controlId: "rowid", controlName: "记录ID", type: 2 },
  { controlId: "wfstatus", controlName: "流程状态", type: 11 },
  { controlId: "section", controlName: "分段", type: 22 }
];

describe("visible columns", () => {
  it("uses the configured field order and removes duplicates", () => {
    const result = resolveVisibleControls({ controls, showFields: ["amount", "arrival", "amount"] });
    expect(result.source).toBe("plugin");
    expect(result.controls.map((control) => control.controlId)).toEqual(["amount", "arrival"]);
  });

  it("ignores deleted and view-hidden fields", () => {
    const result = resolveVisibleControls({
      controls,
      view: { controls: ["material"] },
      showFields: ["missing", "material", "arrival"]
    });
    expect(result.controls.map((control) => control.controlId)).toEqual(["arrival"]);
    expect(result.invalidIds).toEqual(["missing", "material"]);
  });

  it("defaults to business fields without system, workflow or section fields", () => {
    const result = resolveVisibleControls({ controls });
    expect(result.source).toBe("fallback-business");
    expect(result.controls.map((control) => control.controlId)).toEqual(["arrival", "material", "amount"]);
  });

  it("reports validation errors from hidden fields", () => {
    const errors = new Map([["row-1", { material: "必填", amount: "格式错误" }]]);
    expect(hiddenErrorFieldNames(errors, controls, [controls[0], controls[2]])).toEqual(["原料名称"]);
  });
});
