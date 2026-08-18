import { describe, expect, it } from "vitest";
import { canRedo, canUndo, createHistoryState, diffRows, historyReducer, undoDepth } from "./history";

function row(key, values = {}, extra = {}) {
  return { key, values, state: "clean", dirtyFields: [], cellErrors: {}, ...extra };
}

function apply(state, value, label = "编辑") {
  return historyReducer(state, { type: "apply", value, label });
}

describe("row history", () => {
  it("undoes an edit, including validation state", () => {
    const before = row("r1", { name: "旧" });
    const edited = row("r1", { name: "新" }, { state: "error", dirtyFields: ["name"], cellErrors: { name: "无效" } });
    let state = apply(createHistoryState([before]), [edited]);
    state = historyReducer(state, { type: "undo" });
    expect(state.value).toEqual([before]);
    expect(canUndo(state)).toBe(false);
  });

  it("supports redo and clears redo after a new edit", () => {
    let state = apply(createHistoryState([]), [row("a")], "新增");
    state = historyReducer(state, { type: "undo" });
    expect(canRedo(state)).toBe(true);
    state = historyReducer(state, { type: "redo" });
    expect(state.value).toEqual([row("a")]);
    expect(state.lastRedoLabel).toBe("新增");
    state = apply(state, [row("b")], "替换");
    expect(canRedo(state)).toBe(false);
  });

  it("records one batch operation as one history item", () => {
    const before = [row("a", { value: 1 }), row("b", { value: 2 })];
    const after = before.map((item) => ({ ...item, values: { value: 9 } }));
    const state = apply(createHistoryState(before), after, "批量粘贴");
    expect(undoDepth(state)).toBe(1);
    expect(historyReducer(state, { type: "undo" }).value).toEqual(before);
  });

  it("undoes adding and removing rows without disturbing other rows", () => {
    const existing = row("existing");
    const draft = row("draft", { name: "新增" }, { state: "new" });
    let state = apply(createHistoryState([existing]), [existing, draft], "新增记录");
    state = historyReducer(state, { type: "undo" });
    expect(state.value).toEqual([existing]);

    state = apply(state, [existing, draft], "新增记录");
    state = apply(state, [existing], "删除草稿");
    state = historyReducer(state, { type: "undo" });
    expect(state.value).toEqual([existing, draft]);
  });

  it("keeps later appended server rows when undoing", () => {
    const before = row("r1", { name: "旧" });
    const edited = row("r1", { name: "新" });
    let state = apply(createHistoryState([before]), [edited], "编辑");
    const appended = row("r2", { name: "追加" });
    state = historyReducer(state, { type: "replace", value: [edited, appended], clearHistory: false });
    state = historyReducer(state, { type: "undo" });
    expect(state.value).toEqual([before, appended]);
  });

  it("rebases non-user row metadata changes without losing undo", () => {
    const before = row("r1", { name: "旧" });
    const edited = row("r1", { name: "新" });
    let state = apply(createHistoryState([before]), [edited], "编辑");
    const withError = { ...edited, state: "error", saveError: "校验失败" };
    state = historyReducer(state, { type: "replace", value: [withError], clearHistory: false, rebaseHistory: true });
    state = historyReducer(state, { type: "undo" });
    expect(state.value).toEqual([before]);
  });

  it("does not force an undo across an external conflict", () => {
    const before = row("r1", { name: "旧" });
    const edited = row("r1", { name: "新" });
    let state = apply(createHistoryState([before]), [edited], "编辑");
    const external = row("r1", { name: "外部" });
    state = historyReducer(state, { type: "replace", value: [external], clearHistory: false });
    const undone = historyReducer(state, { type: "undo" });
    expect(undone.conflict).toBe(true);
    expect(undone.value).toEqual([external]);
  });

  it("does not record no-op changes and enforces the limit", () => {
    const initial = [row("r1")];
    let state = createHistoryState(initial, 2);
    state = apply(state, initial, "无变化");
    expect(undoDepth(state)).toBe(0);
    state = apply(state, [row("r1", { value: 1 })], "1");
    state = apply(state, [row("r1", { value: 2 })], "2");
    state = apply(state, [row("r1", { value: 3 })], "3");
    expect(undoDepth(state)).toBe(2);
    state = historyReducer(state, { type: "clear" });
    expect(canUndo(state)).toBe(false);
  });

  it("reports row-level differences for additions and removals", () => {
    const a = row("a");
    const b = row("b");
    expect(diffRows([a], [a, b])).toEqual([expect.objectContaining({ key: "b", before: null, after: b, afterIndex: 1 })]);
    expect(diffRows([a, b], [a])).toEqual([expect.objectContaining({ key: "b", before: b, after: null, beforeIndex: 1 })]);
  });
});
