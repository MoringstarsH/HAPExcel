import { structureHash } from "./adapters";

export function draftKey(config) { return `hap-excel-draft:v1:${config.accountId || "session"}:${config.appId || "app"}:${config.worksheetId}:${config.viewId}`; }
export function loadDrafts(config, controls) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(draftKey(config)) || "null");
    if (!saved || saved.structureHash !== structureHash(controls)) return { rows: [], incompatible: Boolean(saved) };
    return { rows: saved.rows || [], incompatible: false };
  } catch (_) { return { rows: [], incompatible: false }; }
}
export function saveDrafts(config, controls, rows) {
  const active = rows.filter((row) => row.isNew || row.dirtyFields?.length);
  if (!active.length) return clearDrafts(config);
  sessionStorage.setItem(draftKey(config), JSON.stringify({ structureHash: structureHash(controls), rows: active }));
}
export function clearDrafts(config) { sessionStorage.removeItem(draftKey(config)); }
