import { describe, expect, it } from "vitest";
import { createDraftRow, defaultValueForControl, editRow, mergeQueriedRows, mergeRestoredDrafts, mergeServerPage, rebaseRowFromServer } from "./rows";

const columns = [{ controlId: "name" }];

describe("row model", () => {
  it("flags a server conflict without overwriting local values", () => {
    const pending = { key: "r-conflict", rowId: "r-conflict", state: "modified", dirtyFields: ["name"], values: { name: "本地值" }, cellErrors: {}, serverSnapshot: { rowid: "r-conflict", name: "旧值" } };
    const merged = mergeServerPage([pending], [{ rowid: "r-conflict", name: "服务端新值" }], columns);
    expect(merged[0]).toMatchObject({ conflict: true, values: { name: "本地值" }, serverSnapshot: { name: "服务端新值" } });
  });
  it("always keeps an edited blank row in new state", () => {
    const row = createDraftRow(columns);
    const edited = editRow(row, "name", "测试", null);
    expect(edited.rowId).toBeNull();
    expect(edited.state).toBe("new");
  });

  it("initializes new rows from HAP field defaults and submits false-like values", () => {
    const row = createDraftRow([
      { controlId: "unit", defaultValue: '["ton"]' },
      { controlId: "enabled", defaultValue: false },
      { controlId: "quantity", advancedSetting: JSON.stringify({ defaultvalue: 0 }) },
      { controlId: "empty", controlName: "不应误判" }
    ]);
    expect(row.values).toEqual({ unit: ["ton"], enabled: false, quantity: 0, empty: "" });
    expect(row.dirtyFields).toEqual(["unit", "enabled", "quantity"]);
  });

  it("does not confuse enumDefault with a configured field default", () => {
    expect(defaultValueForControl({ controlId: "unit", enumDefault: 1 })).toEqual({ hasDefault: false, value: undefined });
  });

  it("reads HAP defsource defaults and converts option labels to keys", () => {
    const unit = {
      controlId: "6a70c1a07737f22ffe796b11",
      type: 11,
      options: [{ key: "ton-key", value: "吨" }, { key: "kg-key", value: "千克" }],
      advancedSetting: JSON.stringify({ defsource: JSON.stringify([{ cid: "6a70c1a07737f22ffe796b11", staticValue: "吨" }]) })
    };
    const tax = {
      controlId: "6a70cb1def20820084f36672",
      type: 11,
      options: [{ key: "tax-key", value: "13%", checked: true }]
    };
    expect(defaultValueForControl(unit)).toEqual({ hasDefault: true, value: ["ton-key"] });
    expect(defaultValueForControl(tax)).toEqual({ hasDefault: true, value: ["tax-key"] });
  });

  it("ignores HAP's empty transport default and reads the real defsource key", () => {
    const control = {
      controlId: "6a70c1a07737f22ffe796b11",
      controlName: "计量单位",
      type: 11,
      default: "",
      options: [{ key: "unit-key", value: "吨", isDeleted: false }],
      advancedSetting: {
        defsource: JSON.stringify([{ rcid: "", cid: "", staticValue: "unit-key", isAsync: false, type: 0 }])
      }
    };
    expect(defaultValueForControl(control)).toEqual({ hasDefault: true, value: ["unit-key"] });
  });

  it("prefers HAP resolved control values only when a default is declared", () => {
    const resolvedTax = {
      controlId: "6a70cb1def20820084f36672",
      type: 11,
      value: ["tax-key"],
      advancedSetting: { defsource: JSON.stringify([{ cid: "", rcid: "", staticValue: "tax-key" }]) },
      options: [{ key: "tax-key", value: "13%" }]
    };
    const ordinary = { controlId: "ordinary", type: 2, value: "服务端运行值" };
    expect(defaultValueForControl(resolvedTax)).toEqual({ hasDefault: true, value: ["tax-key"] });
    expect(defaultValueForControl(ordinary)).toEqual({ hasDefault: false, value: undefined });
  });

  it("uses resolved values for dynamic defaults without copying sentinel values", () => {
    const date = {
      controlId: "date",
      type: 15,
      value: "2026-08-19",
      advancedSetting: { defsource: JSON.stringify([{ cid: "", rcid: "", staticValue: "2", time: "current" }]) }
    };
    const unresolved = {
      controlId: "owner",
      type: 26,
      advancedSetting: { defsource: JSON.stringify([{ cid: "", rcid: "", staticValue: "user-self", isAsync: false }]) }
    };
    expect(defaultValueForControl(date)).toEqual({ hasDefault: true, value: "2026-08-19" });
    expect(defaultValueForControl(unresolved)).toEqual({ hasDefault: false, value: undefined });
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

  it("keeps pending rows visible when a query changes", () => {
    const edited = editRow({
      key: "1", rowId: "1", state: "clean", values: { name: "旧" },
      dirtyFields: [], cellErrors: {}, serverSnapshot: { rowid: "1" }
    }, "name", "本地修改", null);
    const draft = { ...createDraftRow(columns), values: { name: "新增草稿" }, dirtyFields: ["name"] };
    const merged = mergeQueriedRows([edited, draft], [{ rowid: "2", name: "服务端结果" }], columns);
    expect(merged.map((row) => row.values.name)).toEqual(["本地修改", "新增草稿", "服务端结果"]);
  });
  it("refreshes calculated fields without overwriting dirty values", () => {
    const row = editRow({ key: "1", rowId: "1", state: "clean", values: { name: "旧", formula: "2" }, dirtyFields: [], cellErrors: {}, serverSnapshot: {} }, "name", "本地", null);
    const refreshed = rebaseRowFromServer(row, { rowid: "1", name: "服务端", formula: "3" }, [{ controlId: "name" }, { controlId: "formula" }]);
    expect(refreshed.values).toEqual({ name: "本地", formula: "3" });
    expect(refreshed.dirtyFields).toEqual(["name"]);
    expect(refreshed.state).toBe("modified");
  });
});
