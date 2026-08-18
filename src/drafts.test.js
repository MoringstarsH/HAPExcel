import { describe, expect, it } from "vitest";
import { draftKey, loadDrafts, saveDrafts } from "./drafts";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
}

const config = { accountId: "user", appId: "app", worksheetId: "sheet", viewId: "view" };
const controls = [{ controlId: "name", type: 2, controlName: "名称" }];

describe("draft persistence", () => {
  it("restores new, modified and deleted rows", () => {
    const storage = memoryStorage();
    const rows = [
      { key: "new", rowId: null, state: "new", values: { name: "新增" }, dirtyFields: ["name"], cellErrors: {} },
      { key: "old", rowId: "old", state: "modified", values: { name: "修改" }, dirtyFields: ["name"], cellErrors: {} },
      { key: "delete", rowId: "delete", state: "deleted", values: { name: "删除" }, dirtyFields: [], cellErrors: {} }
    ];
    saveDrafts(config, controls, rows, storage);
    const restored = loadDrafts(config, controls, storage);
    expect(restored.rows.map((row) => row.state)).toEqual(["new", "modified", "deleted"]);
  });

  it("migrates a compatible v1 draft", () => {
    const storage = memoryStorage();
    const structureHash = JSON.stringify([["name", 2, "名称", undefined, undefined, undefined, []]]);
    storage.setItem(draftKey(config, 1), JSON.stringify({
      structureHash,
      rows: [{ key: "legacy", rowId: null, isNew: true, values: { name: "旧草稿" }, dirtyFields: ["name"] }]
    }));
    const restored = loadDrafts(config, controls, storage);
    expect(restored.migrated).toBe(true);
    expect(restored.rows[0].state).toBe("new");
  });

  it("migrates v2 failure state into the v3 shape", () => {
    const storage = memoryStorage();
    const structureHash = JSON.stringify([["name", 2, "名称", undefined, undefined, undefined, []]]);
    storage.setItem(draftKey(config, 2), JSON.stringify({
      version: 2,
      structureHash,
      rows: [{ key: "unknown", rowId: null, state: "unknown", values: { name: "可能已保存" }, dirtyFields: ["name"], saveError: "网络中断" }]
    }));
    const restored = loadDrafts(config, controls, storage);
    expect(restored.migrated).toBe(true);
    expect(restored.rows[0]).toMatchObject({ state: "unknown", saveDetails: null, commitBatchId: "" });
  });

  it("preserves member avatar metadata in a draft", () => {
    const storage = memoryStorage();
    const memberControls = [{ controlId: "reporter", type: 26, controlName: "填报人" }];
    const member = [{ accountId: "account-1", fullname: "张三", avatar: "https://example.com/avatar.png" }];
    saveDrafts(config, memberControls, [{
      key: "member-draft",
      rowId: null,
      state: "new",
      values: { reporter: member },
      dirtyFields: ["reporter"],
      cellErrors: {}
    }], storage);
    const restored = loadDrafts(config, memberControls, storage);
    expect(restored.rows[0].values.reporter).toEqual(member);
  });

  it("removes readonly errors and dirty fields left by older paste behavior", () => {
    const storage = memoryStorage();
    const mixedControls = [
      { controlId: "amount", type: 8, controlName: "含税单价" },
      { controlId: "formula", type: 31, controlName: "含税金额" }
    ];
    saveDrafts(config, mixedControls, [{
      key: "mixed",
      rowId: "row-1",
      state: "error",
      values: { amount: 498, formula: 1000 },
      dirtyFields: ["amount", "formula"],
      cellErrors: { formula: "此字段为只读字段" },
      saveError: "请修正字段错误"
    }], storage);
    const restored = loadDrafts(config, mixedControls, storage);
    expect(restored.rows[0]).toEqual(expect.objectContaining({
      state: "modified",
      dirtyFields: ["amount"],
      cellErrors: {},
      saveError: ""
    }));
  });

  it("drops drafts that only contain stale readonly paste errors", () => {
    const storage = memoryStorage();
    const readonlyControls = [{ controlId: "formula", type: 31, controlName: "含税金额" }];
    storage.setItem(draftKey(config, 3), JSON.stringify({
      version: 3,
      structureHash: JSON.stringify([["formula", 31, "含税金额", undefined, undefined, undefined, []]]),
      rows: [{ key: "readonly-only", rowId: null, state: "new", values: { formula: "" }, dirtyFields: ["formula"], cellErrors: { formula: "此字段为只读字段" } }]
    }));
    expect(loadDrafts(config, readonlyControls, storage).rows).toEqual([]);
  });
});
