import { api, apis, md_emitter, utils } from "mdye";
import { LAYOUT_NAMESPACE, layoutToAdvancedSetting } from "./layout";
import { diagnostics } from "./diagnostics";

const worksheetMetaCache = new Map();

function controlsOf(response) {
  if (Array.isArray(response)) return response;
  return response?.template?.controls || response?.data?.template?.controls || response?.controls || response?.data?.controls || (Array.isArray(response?.data) ? response.data : []);
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

function responseMessage(response) {
  return response?.message || response?.msg || response?.errorMessage || response?.data?.message || "HAP 接口返回失败";
}

export function isBusinessFailure(response) {
  if (!response || typeof response !== "object") return false;
  if (response.success === false || response.ok === false || response.state === false) return true;
  return response.errorCode !== undefined && ![0, "0", ""].includes(response.errorCode);
}

export function isNetworkError(error) {
  const text = `${error?.name || ""} ${error?.message || error || ""}`.toLowerCase();
  return error?.name === "AbortError" || /network|fetch|offline|timeout|timed out|断网|网络/.test(text);
}

function responseRowId(response) {
  const data = response?.data || response || {};
  return data.rowid || data.rowId || data.id || null;
}

function mutationFieldShapes(values = []) {
  return values.map((field) => {
    let valueType = Array.isArray(field?.value) ? "array" : typeof field?.value;
    let itemCount;
    if (typeof field?.value === "string" && /^[\[{]/.test(field.value.trim())) {
      try {
        const parsed = JSON.parse(field.value);
        valueType = Array.isArray(parsed) ? "json-array" : "json-object";
        if (Array.isArray(parsed)) itemCount = parsed.length;
      } catch (_) { valueType = "invalid-json-string"; }
    }
    return { controlId: field?.controlId, type: field?.type, valueType, ...(itemCount === undefined ? {} : { itemCount }) };
  });
}

export function normalizeMutation(operation, response) {
  if (isBusinessFailure(response)) return { ok: false, operation, rowId: responseRowId(response), code: response.errorCode || response.code || "BUSINESS_FAILURE", message: responseMessage(response), details: response, retryable: false, outcome: "failed" };
  return { ok: true, operation, rowId: responseRowId(response), code: "", message: "", details: response, retryable: false, outcome: "success" };
}

function normalizeMutationError(operation, error) {
  const network = isNetworkError(error);
  return { ok: false, operation, rowId: null, code: error?.code || (network ? "NETWORK_ERROR" : "REQUEST_ERROR"), message: error?.message || "接口调用失败", details: { name: error?.name }, retryable: network, outcome: network && operation === "add" ? "unknown" : "failed" };
}

export async function withRetry(task, { attempts = 3, delay = 200 } = {}) {
  let lastError;
  for (let index = 0; index < attempts; index += 1) {
    try { return await task(); }
    catch (error) {
      lastError = error;
      if (!isNetworkError(error) || index === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay * (2 ** index)));
    }
  }
  throw lastError;
}

export function createGateway({ appId, worksheetId, viewId, projectId, worksheetInfo }) {
  const relationRecordCache = new Map();
  const inlineWorksheetControls = controlsOf(worksheetInfo);
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
    async loadWorksheetControls() {
      const controlParams = {
        appId,
        worksheetId,
        relationWorksheetId: "",
        getTemplate: true,
        getViews: false,
        handleDefault: false,
        worksheetIds: [],
        handControlSource: false,
        getRules: false,
        getSwitchPermit: false,
        getRelationSearch: false,
        resultType: 3
      };
      let lastError;
      for (const load of [
        () => apis.worksheet?.getWorksheetControls?.(controlParams),
        () => api.getWorksheetInfo({ appId, worksheetId, getTemplate: true })
      ]) {
        if (typeof load !== "function") continue;
        try {
          const response = await withRetry(load);
          if (isBusinessFailure(response)) throw new Error(responseMessage(response));
          const controls = controlsOf(response);
          if (controls.length) return controls;
        } catch (error) { lastError = error; }
      }
      if (lastError) throw lastError;
      return inlineWorksheetControls;
    },
    async loadPage({ pageIndex = 1, pageSize = 100, filters } = {}) {
      const startedAt = globalThis.performance?.now?.() || Date.now();
      try {
        const response = await withRetry(() => api.getFilterRows({ worksheetId, viewId, pageIndex, pageSize, notGetTotal: true, ...(filters || {}) }));
        if (isBusinessFailure(response)) throw new Error(responseMessage(response));
        diagnostics.info("api.loadPage", { pageIndex, pageSize, durationMs: Math.round((globalThis.performance?.now?.() || Date.now()) - startedAt) });
        return rowsOf(response);
      } catch (error) { diagnostics.error("api.loadPage", error, { pageIndex, pageSize }); throw error; }
    },
    async loadTotal(filters) {
      try {
        const response = await withRetry(() => api.getFilterRowsTotalNum({ worksheetId, viewId, ...(filters || {}) }));
        return isBusinessFailure(response) ? null : totalOf(response);
      } catch (error) { diagnostics.error("api.loadTotal", error); return null; }
    },
    async add(values) {
      const fields = mutationFieldShapes(values);
      try {
        const result = normalizeMutation("add", await api.addWorksheetRow({ appId, worksheetId, receiveControls: values }));
        if (!result.ok) diagnostics.info("api.add.failure", { code: result.code, message: result.message, fields });
        return result;
      }
      catch (error) { diagnostics.error("api.add", error, { fields }); return normalizeMutationError("add", error); }
    },
    async update(rowId, values) {
      try { return normalizeMutation("update", await withRetry(() => api.updateWorksheetRow({ appId, worksheetId, rowId, newOldControl: values }))); }
      catch (error) { diagnostics.error("api.update", error, { rowId }); return normalizeMutationError("update", error); }
    },
    async deleteRows(rowIds) {
      try { return normalizeMutation("delete", await withRetry(() => api.deleteWorksheetRow({ appId, worksheetId, rowIds }))); }
      catch (error) { diagnostics.error("api.delete", error, { rowIds }); return normalizeMutationError("delete", error); }
    },
    async saveViewLayout(view, layout) {
      return apis.worksheet.saveWorksheetView(buildViewLayoutPayload({ view, layout, appId, worksheetId, viewId }));
    },
    async loadRowDetail(rowId) {
      const response = await withRetry(() => api.getRowDetail({ appId, worksheetId, viewId, rowId, getTemplate: false }));
      if (isBusinessFailure(response)) throw new Error(responseMessage(response));
      return response?.data || response || {};
    },
    async selectUsers(control) { return utils.selectUsers({ projectId, unique: Number(control?.enumDefault) === 1 }); },
    async selectDepartments(control) { return utils.selectDepartments({ projectId, unique: Number(control?.enumDefault) === 1 || Number(control?.subType) === 1 }); },
    async selectOrgRoles(control) { return utils.selectOrgRole({ projectId, unique: Number(control?.enumDefault) === 1 || Number(control?.subType) === 1 }); },
    async selectLocation(control, current) {
      const selected = await utils.selectLocation({
        distance: Number(control?.advancedSetting?.distance || 1000),
        defaultPosition: current?.lat && current?.lng ? { lat: current.lat, lng: current.lng } : {},
        multiple: false
      });
      return Array.isArray(selected) ? selected[0] : selected;
    },
    async openCurrentRecord(rowId) {
      return utils.openRecordInfo({ appId, worksheetId, viewId, recordId: rowId });
    },
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

export function buildViewLayoutPayload({ view = {}, appId = "", worksheetId = "", viewId = "", layout } = {}) {
  const editAdKeys = Array.isArray(view.editAdKeys) ? view.editAdKeys : [];
  return {
    ...view,
    appId: appId || view.appId,
    worksheetId: worksheetId || view.worksheetId,
    viewId: viewId || view.viewId,
    editAdKeys: [...new Set([...editAdKeys, LAYOUT_NAMESPACE])],
    advancedSetting: layoutToAdvancedSetting(view, layout)
  };
}
