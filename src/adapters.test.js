import { describe, expect, it } from "vitest";
import { attachmentItems, createFieldAdapter, entityItems, getFieldKind, locationValue, memberPresentations, mergeCanonicalControlOptions, numberPresentation, numberPresentationText, optionPresentation, relationLinks, richTextSummary } from "./adapters";

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
      expect.objectContaining({ label: "", color: null, colored: false })
    );
    expect(optionPresentation({ type: 9, colorful: false, options }, "a")).toEqual(
      expect.objectContaining({ label: "待处理", color: null, colored: false })
    );
  });
  it("uses only options from the canonical HAP control metadata", () => {
    const configured = [{ controlId: "tax", type: 9, options: [
      { key: "a", value: "13%" },
      { key: "b", value: "6%" },
      { key: "c", value: "选项3" }
    ]}];
    const canonical = [{ controlId: "tax", type: 9, options: [{ key: "a", value: "13%" }] }];
    expect(mergeCanonicalControlOptions(configured, canonical)[0].options).toEqual([{ key: "a", value: "13%" }]);
    expect(createFieldAdapter(mergeCanonicalControlOptions(configured, canonical)[0]).optionTags(["a", "b"])).toHaveLength(1);
  });
  it("does not expose HAP options marked as deleted", () => {
    const adapter = createFieldAdapter({ type: 11, options: [
      { key: "unit", value: "吨", isDeleted: false },
      { key: "deleted-2", value: "选项2", isDeleted: true },
      { key: "deleted-3", value: "选项3", isDeleted: "true" }
    ] });
    expect(adapter.options.map((option) => option.value)).toEqual(["吨"]);
    expect(adapter.optionTags(["unit", "deleted-2", "deleted-3"]).map((tag) => tag.label)).toEqual(["吨"]);
    expect(adapter.validate(["deleted-2"])).toContain("不存在的选项");
  });
  it("rejects select values whose keys are not in HAP options", () => {
    const adapter = createFieldAdapter({ type: 10, options: [{ key: "a", value: "选择1" }] });
    expect(adapter.validate(["a"])).toBeNull();
    expect(adapter.validate(["b"])).toContain("不存在的选项");
  });
  it("uses clear semantics for checkboxes and numbers", () => {
    expect(createFieldAdapter({ type: 36 }).parseEditor("是").value).toBe(true);
    expect(createFieldAdapter({ type: 36 }).parseEditor("").value).toBe(false);
    expect(createFieldAdapter({ type: 6 }).parseEditor("12.5").value).toBe(12.5);
    expect(createFieldAdapter({ type: 6 }).emptyValue()).toBe("");
    expect(createFieldAdapter({ type: 8 }).emptyValue()).toBe("");
    expect(createFieldAdapter({ type: 36 }).emptyValue()).toBe(false);
    expect(createFieldAdapter({ type: 10 }).emptyValue()).toEqual([]);
    expect(createFieldAdapter({ type: 26 }).emptyValue()).toEqual([]);
    expect(createFieldAdapter({ type: 29 }).emptyValue()).toEqual([]);
  });
  it("keeps member and relation clipboard input explicit", () => {
    expect(createFieldAdapter({ type: 26 }).parseEditor("张三").error).toContain("选择器");
    expect(createFieldAdapter({ type: 29 }).parseEditor("客户").error).toContain("选择器");
  });
  it("formats currency prefixes and configured numeric suffixes", () => {
    const currency = numberPresentation({ type: 8, dot: 2, unit: "￥" }, 2222);
    expect(currency).toEqual(expect.objectContaining({ prefix: "￥", suffix: "", formattedValue: "2,222.00", percentage: false }));
    expect(numberPresentationText(currency)).toBe("￥ 2,222.00");
    const amount = numberPresentation({ type: 31, dot: 2, advancedSetting: { suffix: "元" } }, "1777600");
    expect(numberPresentationText(amount)).toBe("1,777,600.00 元");
  });
  it("resolves HAP amount currency codes and composite currency units", () => {
    const cnyCode = numberPresentation({ type: 8, dot: 2, unit: "CNY" }, 2222);
    expect(cnyCode).toEqual(expect.objectContaining({ prefix: "¥", suffix: "", formattedValue: "2,222.00" }));
    expect(numberPresentationText(cnyCode)).toBe("¥ 2,222.00");
    expect(numberPresentationText(numberPresentation({ type: 8, dot: 2, unit: "CNY-¥ 人民币" }, 498))).toBe("¥ 498.00");
    expect(numberPresentationText(numberPresentation({ type: 8, dot: 2, advancedSetting: { currencyCode: "CNY" } }, 30))).toBe("¥ 30.00");
  });
  it("uses ordinary units as suffixes and respects thousand separator settings", () => {
    expect(numberPresentation({ type: 6, dot: 0, unit: "吨" }, 800)).toEqual(expect.objectContaining({ prefix: "", suffix: "吨", formattedValue: "800" }));
    expect(numberPresentation({ type: 6 }, 12.5).formattedValue).toBe("12.5");
    expect(numberPresentation({ type: 37, dot: 2, advancedSetting: { thousandth: "1" } }, 12345.6).formattedValue).toBe("12345.60");
  });
  it("formats configured percentages before other affixes", () => {
    const percent = numberPresentation({ type: 31, dot: 1, unit: "元", advancedSetting: JSON.stringify({ numshow: "1", prefix: "￥" }) }, 0.135);
    expect(percent).toEqual(expect.objectContaining({ prefix: "", suffix: "%", formattedValue: "13.5", percentage: true }));
    expect(numberPresentationText(percent)).toBe("13.5%");
  });
  it("keeps zero visible and declines non-numeric calculated values", () => {
    expect(numberPresentationText(numberPresentation({ type: 30, dot: 2, advancedSetting: { suffix: "元" } }, 0))).toBe("0.00 元");
    expect(numberPresentation({ type: 30 }, "非数值查找结果")).toBeNull();
    expect(numberPresentation({ type: 2 }, 12)).toBeNull();
  });
  it("normalizes member names and avatars without exposing account ids", () => {
    const adapter = createFieldAdapter({ type: 26 });
    const raw = JSON.stringify([{ accountId: "account-1", fullname: "张三", avatar: "https://example.com/avatar.png" }]);
    expect(memberPresentations(raw)[0]).toEqual(expect.objectContaining({
      accountId: "account-1",
      fullname: "张三",
      avatar: "https://example.com/avatar.png",
      initials: "张三"
    }));
    expect(adapter.display(raw)).toBe("张三");
    expect(adapter.labels(raw)).toEqual(["张三"]);
    expect(adapter.memberTags(raw)[0].accountId).toBe("account-1");
  });
  it("uses initials when a member has no avatar and serializes only account ids", () => {
    const adapter = createFieldAdapter({ type: 26 });
    const tags = adapter.memberTags([{ accountId: "account-2", fullname: "李四" }]);
    expect(tags[0]).toEqual(expect.objectContaining({ fullname: "李四", initials: "李四" }));
    expect(adapter.serialize(tags)).toBe('[{"accountId":"account-2"}]');
    expect(adapter.display([{ accountId: "account-2", fullname: "李四" }])).not.toContain("account-2");
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
  it("classifies the added HAP field types", () => {
    expect(getFieldKind({ type: 14 })).toBe("attachment");
    expect(getFieldKind({ type: 27 })).toBe("department");
    expect(getFieldKind({ type: 40 })).toBe("location");
    expect(getFieldKind({ type: 41 })).toBe("richText");
    expect(getFieldKind({ type: 44 })).toBe("appRole");
    expect(getFieldKind({ type: 48 })).toBe("orgRole");
    expect(getFieldKind({ type: 47 })).toBe("formattedText");
  });
  it("normalizes departments and organization roles while serializing only ids", () => {
    const department = createFieldAdapter({ type: 27 });
    const role = createFieldAdapter({ type: 48 });
    expect(entityItems('[{"departmentId":"d1","departmentName":"质检部"}]', "department")[0].name).toBe("质检部");
    expect(department.serialize([{ departmentId: "d1", departmentName: "质检部" }])).toBe('[{"departmentId":"d1"}]');
    expect(role.serialize([{ organizeId: "r1", organizeName: "项目经理" }])).toBe('[{"organizeId":"r1"}]');
  });
  it("serializes structured HAP strings idempotently", () => {
    const select = createFieldAdapter({ type: 9, options, controlId: "materialType" });
    const member = createFieldAdapter({ type: 26, controlId: "owner" });
    const department = createFieldAdapter({ type: 27, controlId: "department" });
    const role = createFieldAdapter({ type: 48, controlId: "role" });
    const relation = createFieldAdapter({ type: 29, controlId: "supplier" });
    const location = createFieldAdapter({ type: 40, controlId: "location" });
    expect(select.serialize('["a"]')).toBe('["a"]');
    expect(select.serialize(["a"])).toBe('["a"]');
    expect(member.serialize('[{"accountId":"u1","fullname":"张三"}]')).toBe('[{"accountId":"u1"}]');
    expect(department.serialize('[{"departmentId":"d1","departmentName":"采购部"}]')).toBe('[{"departmentId":"d1"}]');
    expect(role.serialize('[{"organizeId":"r1","organizeName":"采购员"}]')).toBe('[{"organizeId":"r1"}]');
    expect(relation.serialize('[{"sid":"s1","name":"供应商"}]')).toBe('[{"sid":"s1"}]');
    expect(location.serialize('{"name":"仓库","lat":31,"lng":121}')).toBe('{"name":"仓库","lat":31,"lng":121}');
  });
  it("rejects malformed structured values before submission", () => {
    expect(createFieldAdapter({ type: 9 }).validate([{ label: "缺少 key" }])).toContain("选项");
    expect(createFieldAdapter({ type: 26 }).validate('[{"fullname":"缺少账号"}]')).toContain("账号 ID");
    expect(createFieldAdapter({ type: 27 }).validate('[{"departmentName":"缺少部门 ID"}]')).toContain("缺少 ID");
    expect(createFieldAdapter({ type: 29 }).validate('[{"name":"缺少记录 ID"}]')).toContain("记录 ID");
    expect(createFieldAdapter({ type: 40 }).validate("not-json")).toContain("定位");
  });
  it("normalizes attachments and rejects unsafe preview urls", () => {
    const items = attachmentItems(JSON.stringify([
      { originalFilename: "现场.jpg", previewUrl: "https://example.com/a.jpg", fileSize: 2048 },
      { name: "恶意.svg", url: "javascript:alert(1)" }
    ]));
    expect(items[0]).toEqual(expect.objectContaining({ name: "现场.jpg", image: true, size: 2048 }));
    expect(items[1].url).toBe("");
  });
  it("summarizes rich text without executable markup", () => {
    expect(richTextSummary('<p>安全内容</p><script>alert(1)</script><b>完成</b>')).toBe("安全内容 完成");
  });
  it("normalizes location values and validates formatted fields", () => {
    expect(locationValue('{"name":"仓库","address":"上海","lat":31,"lng":121}')).toEqual(expect.objectContaining({ name: "仓库", lat: "31", lng: "121" }));
    expect(createFieldAdapter({ type: 5 }).parseEditor("invalid").error).toContain("邮箱");
    expect(createFieldAdapter({ type: 3 }).parseEditor("+86 13800138000").value).toBe("+86 13800138000");
    expect(createFieldAdapter({ type: 47, advancedSetting: { maxlength: 4 } }).parseEditor("12345").error).toContain("4");
  });
});
