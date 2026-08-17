import { api, md_emitter, utils } from "mdye";

export function createGateway({ appId, worksheetId, viewId }) {
  return {
    async load(filters) {
      const response = await api.getFilterRows({ worksheetId, viewId, pageIndex: 1, pageSize: 100, ...(filters || {}) });
      return Array.isArray(response?.data) ? response.data : (Array.isArray(response) ? response : []);
    },
    async add(values) {
      return api.addWorksheetRow({ appId, worksheetId, receiveControls: values });
    },
    async update(rowId, values) {
      return api.updateWorksheetRow({ appId, worksheetId, rowId, newOldControl: values });
    },
    async selectUsers() { return utils.selectUsers({ unique: false }); },
    async selectRecord(control) { return utils.selectRecord({ relateSheetId: control.dataSource || control.sourceControl || worksheetId, multiple: true }); },
    on(event, handler) { md_emitter?.addListener?.(event, handler); return () => md_emitter?.removeListener?.(event, handler); }
  };
}

export function rowIdOf(row) { return row.rowid || row.rowId || row.id; }
