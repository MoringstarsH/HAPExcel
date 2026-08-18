import { api, md_emitter, utils } from "mdye";

const worksheetMetaCache = new Map();

function controlsOf(response) {
  return response?.template?.controls || response?.data?.template?.controls || response?.controls || response?.data?.controls || [];
}

function titleText(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(titleText).filter(Boolean).join(", ");
  return String(value.fullname || value.name || value.title || value.label || value.value || "");
}

export function relationTitleControl(control, targetControls = []) {
  const configuredId = control?.advancedSetting?.showtitleid;
  return targetControls.find((item) => item.controlId === configuredId)
    || targetControls.find((item) => Number(item.attribute) === 1)
    || null;
}

export function normalizeRelationRecord(record, titleControl) {
  const value = record && typeof record === "object" ? record : { rowid: record };
  const sid = value.sid || value.rowid || value.id || "";
  const dynamicTitle = titleControl?.controlId ? titleText(value[titleControl.controlId]) : "";
  const name = dynamicTitle || titleText(value.fullname || value.name || value.title || value.label);
  return { ...value, sid, name };
}

function rowsOf(response) {
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response)) return response;
  return [];
}

function totalOf(response) {
  const value = response?.data?.total ?? response?.data ?? response?.total ?? response;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function createGateway({ appId, worksheetId, viewId }) {
  const relationRecordCache = new Map();
  async function relationMetadata(control) {
    const targetWorksheetId = control?.dataSource || worksheetId;
    const inlineControls = Array.isArray(control?.relationControls) ? control.relationControls : [];
    if (inlineControls.length) return { targetWorksheetId, controls: inlineControls };
    const metadataKey = `${appId || ""}:${targetWorksheetId}`;
    if (!worksheetMetaCache.has(metadataKey)) {
      worksheetMetaCache.set(metadataKey, api.getWorksheetInfo({
        appId,
        worksheetId: targetWorksheetId,
        getTemplate: true
      }).then((response) => ({ targetWorksheetId, controls: controlsOf(response) })).catch((error) => {
        worksheetMetaCache.delete(metadataKey);
        throw error;
      }));
    }
    return worksheetMetaCache.get(metadataKey);
  }

  return {
    async loadPage({ pageIndex = 1, pageSize = 100, filters } = {}) {
      return rowsOf(await api.getFilterRows({ worksheetId, viewId, pageIndex, pageSize, notGetTotal: true, ...(filters || {}) }));
    },
    async loadTotal(filters) {
      try { return totalOf(await api.getFilterRowsTotalNum({ worksheetId, viewId, ...(filters || {}) })); }
      catch (_) { return null; }
    },
    async add(values) { return api.addWorksheetRow({ appId, worksheetId, receiveControls: values }); },
    async update(rowId, values) { return api.updateWorksheetRow({ appId, worksheetId, rowId, newOldControl: values }); },
    async deleteRows(rowIds) { return api.deleteWorksheetRow({ appId, worksheetId, rowIds }); },
    async selectUsers(control) { return utils.selectUsers({ unique: Number(control?.enumDefault) === 1 }); },
    async selectRelation(control) {
      const multiple = !(Number(control?.enumDefault) === 1 || Number(control?.subType) === 1);
      const metadataPromise = relationMetadata(control);
      const selected = await utils.selectRecord({ relateSheetId: control?.dataSource || worksheetId, multiple });
      if (!selected) return selected;
      const metadata = await metadataPromise;
      const titleControl = relationTitleControl(control, metadata.controls);
      const list = Array.isArray(selected) ? selected : [selected];
      return list.map((record) => normalizeRelationRecord(record, titleControl));
    },
    async hydrateRelation(control, record) {
      const normalized = normalizeRelationRecord(record);
      if (!normalized.sid || normalized.name) return normalized;
      const cacheKey = `${control?.dataSource || worksheetId}:${normalized.sid}`;
      if (relationRecordCache.has(cacheKey)) return relationRecordCache.get(cacheKey);
      const request = (async () => {
        try {
          const metadata = await relationMetadata(control);
          const titleControl = relationTitleControl(control, metadata.controls);
          if (!titleControl) return { ...normalized, name: "标题获取失败", titleResolveFailed: true };
          const response = await api.getRowDetail({
            appId,
            worksheetId: metadata.targetWorksheetId,
            viewId: control?.viewId || control?.relationViewId || control?.advancedSetting?.viewid || "",
            rowId: normalized.sid,
            getTemplate: false
          });
          const detail = response?.data || response || {};
          const hydrated = normalizeRelationRecord({ ...detail, sid: normalized.sid }, titleControl);
          return hydrated.name ? hydrated : { ...normalized, name: "标题获取失败", titleResolveFailed: true };
        } catch (_) {
          return { ...normalized, name: "标题获取失败", titleResolveFailed: true };
        }
      })();
      relationRecordCache.set(cacheKey, request);
      return request;
    },
    async openRelationRecord(control, relation) {
      const targetWorksheetId = control?.dataSource;
      const recordId = relation?.recordId || relation?.sid || relation?.rowid || relation?.id;
      if (!targetWorksheetId) throw new Error("关联字段未配置目标工作表");
      if (!recordId) throw new Error("关联记录缺少记录 ID");
      const advancedSetting = control?.advancedSetting || {};
      const targetViewId = control?.viewId || control?.relationViewId || advancedSetting.viewid || advancedSetting.viewId || "";
      return utils.openRecordInfo({ appId, worksheetId: targetWorksheetId, viewId: targetViewId, recordId });
    },
    on(event, handler) {
      md_emitter?.addListener?.(event, handler);
      return () => md_emitter?.removeListener?.(event, handler);
    }
  };
}

export function rowIdOf(row) { return row?.rowid || row?.rowId || row?.id || null; }
