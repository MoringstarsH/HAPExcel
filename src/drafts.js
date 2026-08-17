import { structureHash } from "./adapters";
import { hasPendingChange } from "./rows";

export function draftKey(config, version = 2) {
  return `hap-excel-draft:v${version}:${config.accountId || "session"}:${config.appId || "app"}:${config.worksheetId}:${config.viewId}`;
}

function storageOrDefault(storage) {
  if (storage) return storage;
  try { return sessionStorage; } catch (_) { return null; }
}

function normalizeDraft(row) {
  return {
    ...row,
    state: row.state || (row.isNew || !row.rowId ? "new" : row.dirtyFields?.length ? "modified" : "clean"),
    dirtyFields: Array.isArray(row.dirtyFields) ? row.dirtyFields : [],
    cellErrors: row.cellErrors || {},
    saveError: row.saveError || ""
  };
}

export function loadDrafts(config, controls, storage) {
  const target = storageOrDefault(storage);
  if (!target) return { rows: [], incompatible: false, migrated: false };
  try {
    const current = JSON.parse(target.getItem(draftKey(config, 2)) || "null");
    const legacy = current ? null : JSON.parse(target.getItem(draftKey(config, 1)) || "null");
    const saved = current || legacy;
    if (!saved) return { rows: [], incompatible: false, migrated: false };
    if (saved.structureHash !== structureHash(controls)) return { rows: [], incompatible: true, migrated: Boolean(legacy) };
    return { rows: (saved.rows || []).map(normalizeDraft), incompatible: false, migrated: Boolean(legacy) };
  } catch (_) {
    return { rows: [], incompatible: false, migrated: false };
  }
}

export function saveDrafts(config, controls, rows, storage) {
  const target = storageOrDefault(storage);
  if (!target) return;
  const active = rows.filter(hasPendingChange);
  if (!active.length) return clearDrafts(config, target);
  target.setItem(draftKey(config, 2), JSON.stringify({
    version: 2,
    structureHash: structureHash(controls),
    savedAt: Date.now(),
    rows: active
  }));
  target.removeItem(draftKey(config, 1));
}

export function clearDrafts(config, storage) {
  const target = storageOrDefault(storage);
  if (!target) return;
  target.removeItem(draftKey(config, 2));
  target.removeItem(draftKey(config, 1));
}
