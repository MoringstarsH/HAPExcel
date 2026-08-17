import { describe, expect, it, vi } from "vitest";
import { saveDraftRows } from "./save";

describe("save queue", () => {
  it("continues after one row fails and limits active workers to three", async () => {
    let active = 0; let peak = 0;
    const gateway = { add: vi.fn(async (fields) => { active += 1; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 1)); active -= 1; if (fields[0].value === "bad") throw new Error("拒绝"); return { data: { rowid: fields[0].value } }; }), update: vi.fn() };
    const adapters = [{ control: { controlId: "name", type: 2, required: true }, validate: (value) => value ? null : "必填", serialize: (value) => value }];
    const rows = ["a", "bad", "c", "d"].map((value, index) => ({ key: String(index), isNew: true, values: { name: value }, dirtyFields: ["name"], cellErrors: {} }));
    const results = await saveDraftRows(rows, adapters, gateway);
    expect(peak).toBeLessThanOrEqual(3);
    expect(results.filter((item) => item.ok)).toHaveLength(3);
    expect(results.filter((item) => !item.ok)).toHaveLength(1);
  });
});
