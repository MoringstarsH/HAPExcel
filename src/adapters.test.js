import { describe, expect, it } from "vitest";
import { createFieldAdapter, getFieldKind, optionPresentation, relationLinks } from "./adapters";

const options = [{ key: "a", value: "待处理", color: "#34c759" }, { key: "b", value: "已完成", color: "#f04438" }];

describe("field adapters", () => {
  it("supports both select type 9 and dropdown type 11", () => {
    expect(getFieldKind({ type: 9 })).toBe("select");
    expect(getFieldKind({ type: 11 })).toBe("select");
  });
  it("parses exact select and multi-select labels", () => {
    const single = createFieldAdapter({ type: 9, options });
    const multi = createFieldAdapter({ type: 10, options });
    expect(single.parseEditor("待处理").value).toEqual(["a"]);
    expect(multi.parseEditor("待处理，已完成,待处理").value).toEqual(["a", "b"]);
    expect(single.parseEditor("不存在").error).toContain("未找到");
  });
  it("builds colored tags for single and multi-select values", () => {
    const single = createFieldAdapter({ type: 9, options });
    const multi = createFieldAdapter({ type: 10, options });
    expect(single.optionTags('["a"]')).toEqual([
      expect.objectContaining({ key: "a", label: "待处理", color: "#34c759", colored: true })
    ]);
    expect(multi.optionTags(["a", "b"]).map((tag) => tag.label)).toEqual(["待处理", "已完成"]);
  });
  it("uses stable fallback colors and neutral unknown/disabled tags", () => {
    expect(optionPresentation({ type: 9, options: [{ key: "a", value: "待处理" }] }, "a")).toEqual(
      expect.objectContaining({ color: expect.any(String), colored: true })
    );
    expect(optionPresentation({ type: 9, options }, "missing")).toEqual(
      expect.objectContaining({ label: "missing", color: null, colored: false })
    );
    expect(optionPresentation({ type: 9, colorful: false, options }, "a")).toEqual(
      expect.objectContaining({ label: "待处理", color: null, colored: false })
    );
  });
  it("uses clear semantics for checkboxes and numbers", () => {
    expect(createFieldAdapter({ type: 36 }).parseEditor("是").value).toBe(true);
    expect(createFieldAdapter({ type: 36 }).parseEditor("").value).toBe(false);
    expect(createFieldAdapter({ type: 6 }).parseEditor("12.5").value).toBe(12.5);
  });
  it("keeps member and relation clipboard input explicit", () => {
    expect(createFieldAdapter({ type: 26 }).parseEditor("张三").error).toContain("选择器");
    expect(createFieldAdapter({ type: 29 }).parseEditor("客户").error).toContain("选择器");
  });
  it("keeps relation labels and target record ids for clickable tags", () => {
    expect(relationLinks('[{"sid":"row-a","name":"螺纹钢"}]')).toEqual([
      expect.objectContaining({ label: "螺纹钢", recordId: "row-a" })
    ]);
    expect(relationLinks([{ name: "供应商 A", sourcevalue: JSON.stringify({ rowid: "row-b" }) }])).toEqual([
      expect.objectContaining({ label: "供应商 A", recordId: "row-b" })
    ]);
  });
  it("never exposes a relation record id as its visible label", () => {
    expect(relationLinks([{ sid: "c099989f-ca0a-48eb-9505-eb06e6dc7112" }])).toEqual([
      expect.objectContaining({ label: "正在获取标题…", recordId: "c099989f-ca0a-48eb-9505-eb06e6dc7112" })
    ]);
  });
  it("degrades count-only and malformed relation values safely", () => {
    expect(relationLinks(3)).toEqual([]);
    expect(relationLinks("not-json")).toEqual([]);
    expect(relationLinks([{ name: "无法定位的记录" }])).toEqual([
      expect.objectContaining({ label: "无法定位的记录", recordId: "" })
    ]);
  });
});
