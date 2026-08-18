import { describe, expect, it } from "vitest";
import { buildPasteChanges, createClipboardPayload, mapClipboardCell, parseTsv, readClipboardMatrix } from "./clipboard";
import { createFieldAdapter } from "./adapters";

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

  it("preserves member avatar metadata in structured clipboard data", () => {
    const adapters = [createFieldAdapter({ type: 26, controlId: "owner" })];
    const raw = [{ accountId: "a1", fullname: "张三", avatar: "https://example.com/avatar.png" }];
    const payload = createClipboardPayload({ anchor: { column: 0, row: 0 }, focus: { column: 0, row: 0 } }, [{ values: { owner: raw } }], adapters);
    const copied = readClipboardMatrix(payload.plain, payload.structured)[0][0];
    expect(payload.plain).toBe("张三");
    expect(copied.raw).toEqual(raw);
  });

  it("shows number affixes internally while copying a calculable raw number externally", () => {
    const adapters = [createFieldAdapter({ type: 8, controlId: "amount", dot: 2, unit: "￥" })];
    const payload = createClipboardPayload({ anchor: { column: 0, row: 0 }, focus: { column: 0, row: 0 } }, [{ values: { amount: 2222 } }], adapters);
    const copied = readClipboardMatrix(payload.plain, payload.structured)[0][0];
    expect(payload.plain).toBe("2222");
    expect(copied.text).toBe("￥ 2,222.00");
    expect(copied.raw).toBe(2222);
  });

  it("pastes structured amounts from raw values instead of formatted currency text", () => {
    const source = { sourceKind: "number", sourceControlId: "amount", raw: 498, text: "¥ 498.00" };
    const target = createFieldAdapter({ type: 8, controlId: "newAmount", dot: 2, unit: "CNY" });
    expect(mapClipboardCell(source, target)).toEqual({ value: 498 });
    expect(mapClipboardCell({ ...source, raw: -12.5, text: "￥ -12.50" }, target)).toEqual({ value: -12.5 });
    expect(mapClipboardCell({ ...source, raw: 0, text: "¥ 0.00" }, target)).toEqual({ value: 0 });
  });

  it("fills a selected range from one cell", () => {
    const result = buildPasteChanges({ matrix: [[{ text: "7", external: true }]], selection: { anchor: { column: 0, row: 0 }, focus: { column: 1, row: 2 } }, adapters: [adapter("number", "n1"), adapter("number", "n2")], rowCount: 3 });
    expect(result.changes).toHaveLength(6);
    expect(result.changes.every((change) => change.parsedValue === 7)).toBe(true);
  });

  it("supports skipping empty sources and filling only blank targets", () => {
    const adapters = [adapter("text", "name"), adapter("text", "code")];
    const selection = { anchor: { column: 0, row: 0 }, focus: { column: 1, row: 1 } };
    const rows = [
      { values: { name: "已有", code: "已有" } },
      { values: { name: "", code: "已有" } }
    ];
    const matrix = [[{ text: "", external: true }, { text: "新", external: true }], [{ text: "新2", external: true }, { text: "", external: true }]];
    expect(buildPasteChanges({ matrix, selection, adapters, rows, rowCount: 2, pasteMode: "skipEmpty" }).changes).toEqual([
      expect.objectContaining({ rowIndex: 0, columnIndex: 1 }),
      expect.objectContaining({ rowIndex: 1, columnIndex: 0 })
    ]);
    expect(buildPasteChanges({ matrix, selection, adapters, rows, rowCount: 2, pasteMode: "fillBlank" }).changes).toEqual([
      expect.objectContaining({ rowIndex: 1, columnIndex: 0 })
    ]);
  });

  it("enforces structured special-field compatibility", () => {
    const source = { sourceKind: "relation", sourceControlId: "r1", raw: [{ sid: "x" }], text: "客户A" };
    expect(mapClipboardCell(source, adapter("relation", "r1")).value[0].sid).toBe("x");
    expect(mapClipboardCell(source, adapter("text", "t1")).value).toBe("客户A");
    expect(mapClipboardCell(source, adapter("relation", "r2")).error).toContain("来源字段不同");
    expect(mapClipboardCell(source, adapter("number", "n1")).error).toContain("类型不匹配");
  });

  it("skips readonly targets without producing changes or errors", () => {
    const readonly = adapter("readonly", "formula", false);
    expect(mapClipboardCell({ text: "100", external: true }, readonly)).toEqual({ skipped: true, reason: "readonly" });
    const result = buildPasteChanges({
      matrix: [[{ text: "498", external: true }, { text: "100", external: true }]],
      selection: { anchor: { column: 0, row: 0 }, focus: { column: 0, row: 0 } },
      adapters: [adapter("number", "amount"), readonly],
      rowCount: 0
    });
    expect(result.changes).toEqual([expect.objectContaining({ columnIndex: 0, parsedValue: 498 })]);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toEqual([expect.objectContaining({ columnIndex: 1, reason: "readonly" })]);
  });

  it("returns no changes when every paste target is readonly", () => {
    const result = buildPasteChanges({
      matrix: [[{ text: "100", external: true }]],
      selection: { anchor: { column: 0, row: 2 }, focus: { column: 1, row: 2 } },
      adapters: [adapter("readonly", "formula", false), adapter("readonly", "rollup", false)],
      rowCount: 2
    });
    expect(result.changes).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toHaveLength(2);
  });
});
