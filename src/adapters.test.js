import { describe, expect, it } from "vitest";
import { createFieldAdapter, getFieldKind, relationLinks } from "./adapters";

const options = [{ key: "a", value: "待处理" }, { key: "b", value: "已完成" }];

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
  it("degrades count-only and malformed relation values safely", () => {
    expect(relationLinks(3)).toEqual([]);
    expect(relationLinks("not-json")).toEqual([]);
    expect(relationLinks([{ name: "无法定位的记录" }])).toEqual([
      expect.objectContaining({ label: "无法定位的记录", recordId: "" })
    ]);
  });
});
