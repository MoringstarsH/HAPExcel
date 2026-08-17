import { describe, expect, it } from "vitest";
import { createDraftRow, editRow, mergeRestoredDrafts, mergeServerPage } from "./rows";

const columns = [{ controlId: "name" }];

describe("row model", () => {
  it("always keeps an edited blank row in new state", () => {
    const row = createDraftRow(columns);
    const edited = editRow(row, "name", "测试", null);
    expect(edited.rowId).toBeNull();
    expect(edited.state).toBe("new");
  });

  it("restores new drafts instead of dropping them", () => {
    const draft = { ...createDraftRow(columns), values: { name: "恢复" }, dirtyFields: ["name"] };
    const merged = mergeRestoredDrafts([], [draft], columns);
    expect(merged).toHaveLength(1);
    expect(merged[0].values.name).toBe("恢复");
  });

  it("does not duplicate server rows across virtual pages", () => {
    const initial = [{ key: "1", rowId: "1", state: "clean", values: { name: "A" }, dirtyFields: [], cellErrors: {}, serverSnapshot: { rowid: "1" } }];
    const merged = mergeServerPage(initial, [{ rowid: "1", name: "A" }, { rowid: "2", name: "B" }], columns);
    expect(merged.map((row) => row.rowId)).toEqual(["1", "2"]);
  });
});
