import { describe, expect, it } from "vitest";
import { buildPasteChanges, createClipboardPayload, mapClipboardCell, parseTsv, readClipboardMatrix } from "./clipboard";

function adapter(kind, id, writable = true) {
  return { kind, writable, control: { controlId: id }, display: String, parseClipboard: (text) => kind === "number" && Number.isNaN(Number(text)) ? { error: "请输入有效数字" } : { value: kind === "number" ? Number(text) : text } };
}

describe("clipboard", () => {
  it("parses rectangular TSV", () => expect(parseTsv("a\tb\r\nc\td\n")).toEqual([["a", "b"], ["c", "d"]]));

  it("preserves structured values and plain text", () => {
    const adapters = [adapter("member", "owner")];
    adapters[0].display = () => "张三";
    const payload = createClipboardPayload({ anchor: { column: 0, row: 0 }, focus: { column: 0, row: 0 } }, [{ values: { owner: [{ accountId: "a1" }] } }], adapters);
    expect(payload.plain).toBe("张三");
    expect(readClipboardMatrix(payload.plain, payload.structured)[0][0].raw[0].accountId).toBe("a1");
  });

  it("fills a selected range from one cell", () => {
    const result = buildPasteChanges({ matrix: [[{ text: "7", external: true }]], selection: { anchor: { column: 0, row: 0 }, focus: { column: 1, row: 2 } }, adapters: [adapter("number", "n1"), adapter("number", "n2")], rowCount: 3 });
    expect(result.changes).toHaveLength(6);
    expect(result.changes.every((change) => change.parsedValue === 7)).toBe(true);
  });

  it("enforces structured special-field compatibility", () => {
    const source = { sourceKind: "relation", sourceControlId: "r1", raw: [{ sid: "x" }], text: "客户A" };
    expect(mapClipboardCell(source, adapter("relation", "r1")).value[0].sid).toBe("x");
    expect(mapClipboardCell(source, adapter("text", "t1")).value).toBe("客户A");
    expect(mapClipboardCell(source, adapter("relation", "r2")).error).toContain("来源字段不同");
    expect(mapClipboardCell(source, adapter("number", "n1")).error).toContain("类型不匹配");
  });
});
