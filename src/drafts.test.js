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
});
