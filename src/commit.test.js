import { describe, expect, it, vi } from "vitest";
import { createFieldAdapter } from "./adapters";
import { applyCommitResult, commitRows, commitSummary, normalizeOptionalFieldErrors, validateRows } from "./commit";

const text = createFieldAdapter({ controlId: "name", controlName: "名称", type: 2, required: true });
const relation = createFieldAdapter({ controlId: "customer", controlName: "客户", type: 29 });
const optionalNumber = createFieldAdapter({ controlId: "quantity", type: 6 });
const optionalEmail = createFieldAdapter({ controlId: "email", type: 5 });
const optionalDate = createFieldAdapter({ controlId: "date", type: 15 });

function newRow(values, dirtyFields) {
  return { key: "new-1", rowId: null, state: "new", values, dirtyFields, cellErrors: {}, serverSnapshot: {}, saveError: "" };
}

function serverRow(state = "modified") {
  return { key: "row-1", rowId: "row-1", state, values: { name: "新名称", customer: [] }, dirtyFields: state === "modified" ? ["name"] : [], cellErrors: {}, serverSnapshot: { rowid: "row-1" }, saveError: "" };
}

describe("commit pipeline", () => {
  it("normalizes invalid optional values to empty without blocking save", async () => {
    const gateway = { add: vi.fn(async () => ({ data: { rowid: "created" } })), update: vi.fn(), deleteRows: vi.fn() };
    const row = { ...newRow({ quantity: "not-a-number", email: "invalid", date: "2026-02-30" }, ["quantity", "email", "date"]), cellErrors: { quantity: "请输入有效数字", email: "请输入有效邮箱地址", date: "日期或时间无效" } };
    expect(validateRows(normalizeOptionalFieldErrors([row], [optionalNumber, optionalEmail, optionalDate]), [optionalNumber, optionalEmail, optionalDate]).size).toBe(0);
    const result = await commitRows([row], [optionalNumber, optionalEmail, optionalDate], gateway);
    expect(gateway.add.mock.calls[0][0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ controlId: "quantity", value: "" }),
      expect.objectContaining({ controlId: "email", value: "" }),
      expect.objectContaining({ controlId: "date", value: "" })
    ]));
    expect(result.writes[0].ok).toBe(true);
  });

  it("submits an explicitly cleared optional number as an empty value", async () => {
    const gateway = { add: vi.fn(), update: vi.fn(async () => ({ success: true })), deleteRows: vi.fn() };
    const row = { ...serverRow(), values: { quantity: "" }, dirtyFields: ["quantity"] };

    await commitRows([row], [optionalNumber], gateway);

    expect(gateway.update).toHaveBeenCalledWith("row-1", [
      { controlId: "quantity", type: 6, value: "" }
    ]);
  });

  it("stops scheduling writes after cancellation and preserves cancelled rows", async () => {
    const controller = new AbortController();
    const gateway = { add: vi.fn(), update: vi.fn(async () => { controller.abort(); return { success: true }; }), deleteRows: vi.fn() };
    const rows = [
      { ...serverRow(), key: "row-1", rowId: "row-1", values: { quantity: 1 }, dirtyFields: ["quantity"] },
      { ...serverRow(), key: "row-2", rowId: "row-2", values: { quantity: 2 }, dirtyFields: ["quantity"] },
      { ...serverRow(), key: "row-3", rowId: "row-3", values: { quantity: 3 }, dirtyFields: ["quantity"] },
      { ...serverRow(), key: "row-4", rowId: "row-4", values: { quantity: 4 }, dirtyFields: ["quantity"] }
    ];
    const result = await commitRows(rows, [optionalNumber], gateway, () => {}, { signal: controller.signal });
    expect(result.cancelled).toBe(true);
    expect(result.writes.some((entry) => entry.outcome === "cancelled")).toBe(true);
    expect(applyCommitResult(rows, result).some((row) => row.key === "row-2")).toBe(true);
  });

  it("still blocks invalid or empty required values", () => {
    const requiredNumber = createFieldAdapter({ controlId: "quantity", type: 6, required: true });
    const invalid = { ...newRow({ quantity: "bad" }, ["quantity"]), cellErrors: { quantity: "请输入有效数字" } };
    const empty = { ...newRow({ quantity: "" }, ["quantity"]), cellErrors: { quantity: "此字段为必填字段" } };
    expect(validateRows([invalid], [requiredNumber]).get(invalid.key).quantity).toContain("数字");
    expect(validateRows([empty], [requiredNumber]).get(empty.key).quantity).toContain("必填");
  });

  it("adds a blank-row draft whose first edit is a relation selection", async () => {
    const gateway = {
      add: vi.fn(async () => ({ data: { rowid: "created" } })),
      update: vi.fn(),
      deleteRows: vi.fn()
    };
    const row = newRow({ name: "关联录入", customer: [{ sid: "customer-1", name: "客户A" }] }, ["customer", "name"]);
    const result = await commitRows([row], [text, relation], gateway);
    expect(gateway.add).toHaveBeenCalledOnce();
    expect(gateway.update).not.toHaveBeenCalled();
    expect(result.writes[0].ok).toBe(true);
    expect(applyCommitResult([row], result)[0].rowId).toBe("created");
  });

  it("submits copied rows with option JSON encoded exactly once", async () => {
    const controls = [
      createFieldAdapter({ controlId: "date", type: 15 }),
      createFieldAdapter({ controlId: "materialType", type: 9 }),
      createFieldAdapter({ controlId: "name", type: 2 }),
      createFieldAdapter({ controlId: "quantity", type: 6 }),
      createFieldAdapter({ controlId: "unit", type: 9 }),
      createFieldAdapter({ controlId: "amount", type: 8 })
    ];
    const rows = Array.from({ length: 6 }, (_, index) => ({
      ...newRow({ date: "2026-08-19", materialType: '["stone"]', name: "螺纹钢", quantity: 800, unit: '["ton"]', amount: 498 }, ["date", "materialType", "name", "quantity", "unit", "amount"]),
      key: `copy-${index}`
    }));
    const gateway = { add: vi.fn(async () => ({ data: { rowid: crypto.randomUUID() } })), update: vi.fn(), deleteRows: vi.fn() };
    const result = await commitRows(rows, controls, gateway);
    expect(result.writes.every((entry) => entry.ok)).toBe(true);
    expect(gateway.add).toHaveBeenCalledTimes(6);
    gateway.add.mock.calls.forEach(([fields]) => {
      expect(fields.find((field) => field.controlId === "materialType")?.value).toBe('["stone"]');
      expect(fields.find((field) => field.controlId === "unit")?.value).toBe('["ton"]');
      expect(fields.find((field) => field.controlId === "amount")?.value).toBe(498);
    });
  });

  it("blocks malformed structured fields before calling the gateway", async () => {
    const invalidSelect = createFieldAdapter({ controlId: "materialType", type: 9, required: true });
    const row = newRow({ materialType: [{ label: "缺少 key" }] }, ["materialType"]);
    const gateway = { add: vi.fn(), update: vi.fn(), deleteRows: vi.fn() };
    const result = await commitRows([row], [invalidSelect], gateway);
    expect(result.validationErrors.get(row.key)?.materialType).toContain("选项");
    expect(gateway.add).not.toHaveBeenCalled();
  });

  it("keeps failed writes and skips irreversible deletion", async () => {
    const modified = serverRow();
    const deleted = { ...serverRow("deleted"), key: "delete-1", rowId: "delete-1", dirtyFields: [] };
    const gateway = {
      add: vi.fn(),
      update: vi.fn(async () => { throw new Error("拒绝更新"); }),
      deleteRows: vi.fn()
    };
    const result = await commitRows([modified, deleted], [text, relation], gateway);
    expect(result.deleteSkipped).toBe(true);
    expect(gateway.deleteRows).not.toHaveBeenCalled();
    const next = applyCommitResult([modified, deleted], result);
    expect(next[0].state).toBe("error");
    expect(next[1].state).toBe("deleted");
  });

  it("deletes in one batch only after writes succeed", async () => {
    const modified = serverRow();
    const deleted = { ...serverRow("deleted"), key: "delete-1", rowId: "delete-1", dirtyFields: [] };
    const gateway = {
      add: vi.fn(),
      update: vi.fn(async () => ({ data: { rowid: "row-1" } })),
      deleteRows: vi.fn(async () => ({ success: true }))
    };
    const result = await commitRows([modified, deleted], [text, relation], gateway);
    expect(gateway.deleteRows).toHaveBeenCalledWith(["delete-1"]);
    const next = applyCommitResult([modified, deleted], result);
    expect(next).toHaveLength(1);
    expect(next[0].state).toBe("clean");
  });

  it("limits active write workers to three", async () => {
    let active = 0;
    let peak = 0;
    const gateway = {
      add: vi.fn(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return { data: { rowid: Math.random().toString() } };
      }),
      update: vi.fn(),
      deleteRows: vi.fn()
    };
    const rows = Array.from({ length: 8 }, (_, index) => ({ ...newRow({ name: `记录${index}`, customer: [] }, ["name"]), key: String(index) }));
    await commitRows(rows, [text, relation], gateway);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("ignores an untouched trailing draft row during another save", async () => {
    const gateway = {
      add: vi.fn(),
      update: vi.fn(async () => ({ data: { rowid: "row-1" } })),
      deleteRows: vi.fn()
    };
    const blank = newRow({ name: "", customer: [] }, []);
    const result = await commitRows([serverRow(), blank], [text, relation], gateway);
    expect(result.validationErrors.size).toBe(0);
    expect(gateway.update).toHaveBeenCalledOnce();
    expect(gateway.add).not.toHaveBeenCalled();
  });

  it("keeps an ambiguous add as unknown and never deletes in that batch", async () => {
    const created = newRow({ name: "可能已创建", customer: [] }, ["name"]);
    const deleted = { ...serverRow("deleted"), key: "delete-2", rowId: "delete-2", dirtyFields: [] };
    const gateway = {
      add: vi.fn(async () => ({ ok: false, operation: "add", outcome: "unknown", code: "NETWORK_ERROR", message: "网络中断", retryable: true })),
      update: vi.fn(), deleteRows: vi.fn()
    };
    const result = await commitRows([created, deleted], [text, relation], gateway);
    const next = applyCommitResult([created, deleted], result);
    expect(next[0]).toMatchObject({ state: "unknown", saveError: "网络中断" });
    expect(gateway.deleteRows).not.toHaveBeenCalled();
    expect(commitSummary(result)).toMatchObject({ add: { unknown: 1 }, delete: { skipped: 1 } });
  });
});
