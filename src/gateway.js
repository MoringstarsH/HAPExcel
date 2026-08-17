import { api, md_emitter, utils } from "mdye";

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
      return utils.selectRecord({ relateSheetId: control?.dataSource || worksheetId, multiple });
    },
    on(event, handler) {
      md_emitter?.addListener?.(event, handler);
      return () => md_emitter?.removeListener?.(event, handler);
    }
  };
}

export function rowIdOf(row) { return row?.rowid || row?.rowId || row?.id || null; }
