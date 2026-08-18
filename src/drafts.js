import { isWritableControl, structureHash } from "./adapters";
import { hasPendingChange } from "./rows";
import { diagnostics } from "./diagnostics";

export function draftKey(config, version = 3) {
  return `hap-excel-draft:v${version}:${config.accountId || "session"}:${config.appId || "app"}:${config.worksheetId}:${config.viewId}`;
}

function storageOrDefault(storage) {
  if (storage) return storage;
  try { return sessionStorage; } catch (_) { return null; }
}

function normalizeDraft(row, writableIds) {
  const dirtyFields = (Array.isArray(row.dirtyFields) ? row.dirtyFields : []).filter((fieldId) => writableIds.has(fieldId));
  const cellErrors = Object.fromEntries(Object.entries(row.cellErrors || {}).filter(([fieldId]) => writableIds.has(fieldId)));
  const hasErrors = Object.keys(cellErrors).length > 0;
  const preservedState = ["deleted", "unknown"].includes(row.state);
  const state = preservedState
    ? row.state
    : !row.rowId ? "new" : hasErrors ? "error" : dirtyFields.length ? "modified" : "clean";
  return {
    ...row,
    state,
    dirtyFields,
    cellErrors,
    saveError: !hasErrors && row.saveError === "请修正字段错误" ? "" : row.saveError || "",
    saveDetails: row.saveDetails || null,
    commitBatchId: row.commitBatchId || ""
  };
}

export function loadDrafts(config, controls, storage) {
  const target = storageOrDefault(storage);
  if (!target) return { rows: [], incompatible: false, migrated: false };
  try {
    const current = JSON.parse(target.getItem(draftKey(config, 3)) || "null");
    const v2 = current ? null : JSON.parse(target.getItem(draftKey(config, 2)) || "null");
    const legacy = current || v2 ? null : JSON.parse(target.getItem(draftKey(config, 1)) || "null");
    const saved = current || v2 || legacy;
    if (!saved) return { rows: [], incompatible: false, migrated: false };
    if (saved.structureHash !== structureHash(controls)) return { rows: [], incompatible: true, migrated: Boolean(v2 || legacy) };
    const writableIds = new Set(controls.filter(isWritableControl).map((control) => control.controlId));
    const rows = (saved.rows || []).map((row) => normalizeDraft(row, writableIds)).filter(hasPendingChange);
    return { rows, incompatible: false, migrated: Boolean(v2 || legacy), savedAt: saved.savedAt };
  } catch (error) {
    diagnostics.error("draft.load", error);
    return { rows: [], incompatible: false, migrated: false };
  }
}

export function saveDrafts(config, controls, rows, storage) {
  const target = storageOrDefault(storage);
  if (!target) return { ok: false, error: "存储不可用" };
  const active = rows.filter(hasPendingChange);
  if (!active.length) return clearDrafts(config, target);
  try {
    target.setItem(draftKey(config, 3), JSON.stringify({ version: 3, structureHash: structureHash(controls), savedAt: Date.now(), rows: active }));
    target.removeItem(draftKey(config, 2));
    target.removeItem(draftKey(config, 1));
    return { ok: true };
  } catch (error) {
    diagnostics.error("draft.save", error);
    return { ok: false, error: error?.message || "草稿保存失败" };
  }
}

export function clearDrafts(config, storage) {
  const target = storageOrDefault(storage);
  if (!target) return { ok: false };
  target.removeItem(draftKey(config, 3));
  target.removeItem(draftKey(config, 2));
  target.removeItem(draftKey(config, 1));
  return { ok: true };
}
