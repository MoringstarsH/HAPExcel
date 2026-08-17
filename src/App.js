import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { config } from "mdye";
import { DataEditor, GridCellKind } from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import { createFieldAdapter, getControls } from "./adapters";
import { createGateway, rowIdOf } from "./gateway";
import { clearDrafts, loadDrafts, saveDrafts } from "./drafts";
import { saveDraftRows } from "./save";

const MAX_CELLS = 5000;
const MAX_NEW_ROWS = 200;
const MAX_ROWS = 100 + MAX_NEW_ROWS;

function emptyRow(index, columns) {
  return { key: `temp-${Date.now()}-${index}`, rowId: null, tempId: `temp-${index}`, serverSnapshot: {}, values: Object.fromEntries(columns.map((column) => [column.controlId, ""])), dirtyFields: [], cellErrors: {}, isNew: false, saveStatus: "idle", saveError: "" };
}

function normalizeResponseRow(row, columns, index) {
  const rowId = rowIdOf(row);
  return { key: rowId || `temp-${Date.now()}-${index}`, rowId, serverSnapshot: { ...row }, values: Object.fromEntries(columns.map((column) => [column.controlId, row[column.controlId] ?? ""])), dirtyFields: [], cellErrors: {}, isNew: false, saveStatus: "idle", saveError: "" };
}

function cellStart(target) {
  return target?.cell || target?.range?.start || target?.start || target || [0, 0];
}

export default function App() {
  const runtimeConfig = config || {};
  const controls = useMemo(() => getControls(runtimeConfig), [runtimeConfig]);
  const [records, setRecords] = useState([]);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("正在加载记录…");
  const [refreshPending, setRefreshPending] = useState(false);
  const [lastSave, setLastSave] = useState(null);
  const [hydrated, setHydrated] = useState(false);
  const saveTimer = useRef(null);
  const gateway = useMemo(() => createGateway(runtimeConfig), [runtimeConfig.appId, runtimeConfig.worksheetId, runtimeConfig.viewId]);
  const columns = useMemo(() => {
    if (controls.length) return controls.map((control) => ({ ...control, title: control.controlName || control.controlId }));
    const keys = Object.keys(records[0]?.serverSnapshot || {}).filter((key) => !["rowid", "rowId", "id"].includes(key));
    return keys.map((controlId) => ({ controlId, controlName: controlId, title: controlId, type: 2 }));
  }, [controls, records]);
  const adapters = useMemo(() => columns.map(createFieldAdapter), [columns]);
  const hasDrafts = records.some((row) => row.isNew || row.dirtyFields?.length);

  const load = useCallback(async (filters) => {
    setStatus("loading"); setMessage("正在加载记录…");
    try {
      const serverRows = await gateway.load(filters);
      const loadColumns = columns.length ? columns : Object.keys(serverRows[0] || {}).filter((key) => !["rowid", "rowId", "id"].includes(key)).map((controlId) => ({ controlId, controlName: controlId, title: controlId, type: 2 }));
      const loaded = serverRows.slice(0, 100).map((row, index) => normalizeResponseRow(row, loadColumns, index));
      const restored = loadDrafts(runtimeConfig, loadColumns);
      if (restored.incompatible) setMessage("字段结构已变化，旧草稿未恢复，请确认后重新录入");
      const byKey = new Map(restored.rows.map((row) => [row.key, row]));
      const merged = loaded.map((row) => byKey.get(row.key) ? { ...row, ...byKey.get(row.key), serverSnapshot: row.serverSnapshot, isNew: false } : row);
      restored.rows.filter((row) => row.isNew && !byKey.has(row.key)).forEach((row) => merged.push({ ...row, isNew: true }));
      while (merged.length < Math.min(loaded.length + 10 + restored.rows.filter((row) => row.isNew).length, MAX_ROWS)) merged.push(emptyRow(merged.length, loadColumns));
      setRecords(merged); setStatus("ready");
      setHydrated(true);
      if (restored.rows.length) setMessage("已恢复当前标签页草稿；保存或放弃后将清除草稿");
      else if (!restored.incompatible) setMessage(`已加载 ${loaded.length} 条记录，可直接编辑`);
    } catch (error) { setStatus("failed"); setMessage(`加载失败：${error?.message || "请检查视图权限"}`); }
  }, [gateway, columns, runtimeConfig]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => gateway.on("filters-update", (filters) => { if (hasDrafts) setRefreshPending(true); else load(filters); }), [gateway, hasDrafts, load]);
  useEffect(() => gateway.on("new-record", () => { if (hasDrafts) setRefreshPending(true); else load(); }), [gateway, hasDrafts, load]);
  useEffect(() => () => clearTimeout(saveTimer.current), []);
  useEffect(() => { if (!hydrated) return undefined; clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => saveDrafts(runtimeConfig, columns, records), 300); return () => clearTimeout(saveTimer.current); }, [hydrated, runtimeConfig, columns, records]);

  const applyCellChanges = useCallback((changes) => {
    setRecords((previous) => {
      const next = previous.map((row) => ({ ...row, values: { ...row.values }, dirtyFields: [...row.dirtyFields], cellErrors: { ...row.cellErrors } }));
      changes.forEach(({ rowIndex, columnIndex, input }) => {
        if (!next[rowIndex]) while (next.length <= rowIndex && next.length < MAX_ROWS) next.push(emptyRow(next.length, columns));
        const row = next[rowIndex]; const adapter = adapters[columnIndex]; if (!row || !adapter) return;
        const fieldId = adapter.control.controlId; const parsed = adapter.parseEditor(input);
        if (parsed.error) { row.cellErrors[fieldId] = parsed.error; return; }
        delete row.cellErrors[fieldId]; row.values[fieldId] = parsed.value; if (!row.dirtyFields.includes(fieldId)) row.dirtyFields.push(fieldId); row.isNew = row.isNew || !row.rowId; row.saveStatus = "idle"; row.saveError = "";
      });
      return next;
    });
  }, [adapters, columns]);

  const getCellContent = useCallback(([columnIndex, rowIndex]) => {
    const row = records[rowIndex]; const adapter = adapters[columnIndex];
    if (!row || !adapter) return { kind: GridCellKind.Text, data: "", displayData: "", allowOverlay: false };
    const fieldId = adapter.control.controlId; const error = row.cellErrors[fieldId];
    const rawValue = row.values[fieldId];
    return { kind: adapter.kind === "number" ? GridCellKind.Number : GridCellKind.Text, data: adapter.kind === "number" ? (rawValue === "" || rawValue == null ? 0 : Number(rawValue)) : adapter.display(rawValue), displayData: error ? `⚠ ${error}` : adapter.display(rawValue), allowOverlay: !["readonly"].includes(adapter.kind) && !adapter.control.readonly && !adapter.control.disabled, theme: error ? { textDark: "#b42318", bgCell: "#fff1f0" } : undefined };
  }, [records, adapters]);

  const onPaste = useCallback((target, values) => {
    const matrix = Array.isArray(values) ? values : [];
    const cells = matrix.reduce((sum, row) => sum + row.length, 0);
    if (cells > MAX_CELLS) { setMessage(`粘贴已拒绝：单次最多 ${MAX_CELLS} 个单元格`); return false; }
    const [startColumn, startRow] = cellStart(target);
    if (Math.max(0, startRow + matrix.length - records.length) > MAX_NEW_ROWS || startRow + matrix.length > MAX_ROWS) { setMessage(`粘贴已拒绝：单次最多新增 ${MAX_NEW_ROWS} 行`); return false; }
    applyCellChanges(matrix.flatMap((row, rowOffset) => row.map((input, columnOffset) => ({ rowIndex: startRow + rowOffset, columnIndex: startColumn + columnOffset, input }))));
    return false;
  }, [applyCellChanges, records.length]);

  const onFillPattern = useCallback((event) => {
    event.preventDefault();
    const sourceRange = event.patternSource; const destination = event.fillDestination;
    if (!sourceRange || !destination) return;
    const startColumn = destination.x; const startRow = destination.y; const source = [];
    for (let row = sourceRange.y; row < sourceRange.y + sourceRange.height; row += 1) source.push(Array.from({ length: sourceRange.width }, (_, column) => adapters[sourceRange.x + column] ? adapters[sourceRange.x + column].display(records[row]?.values[adapters[sourceRange.x + column].control.controlId]) : ""));
    const changes = [];
    for (let row = startRow; row < startRow + destination.height; row += 1) source[(row - startRow) % source.length]?.forEach((value, offset) => changes.push({ rowIndex: row, columnIndex: startColumn + offset, input: value }));
    if (startRow + destination.height > MAX_ROWS) { setMessage(`填充已拒绝：最多支持 ${MAX_NEW_ROWS} 个新增行`); return; }
    applyCellChanges(changes);
  }, [adapters, applyCellChanges, records]);

  const getCellsForSelection = useCallback((range) => {
    if (!range) return [];
    const cells = [];
    for (let row = range.y; row < range.y + range.height; row += 1) cells.push(Array.from({ length: range.width }, (_, column) => getCellContent([column + range.x, row])));
    return cells;
  }, [getCellContent]);

  async function selectForCell([columnIndex, rowIndex]) {
    const row = records[rowIndex]; const adapter = adapters[columnIndex]; if (!row || !adapter) return;
    try {
      const selected = adapter.kind === "member" ? await gateway.selectUsers() : adapter.kind === "relation" ? await gateway.selectRecord(adapter.control) : null;
      if (!selected) return;
      const values = Array.isArray(selected) ? selected : [selected];
      const fieldId = adapter.control.controlId;
       const internal = adapter.kind === "member" ? values.map((item) => ({ accountId: item.accountId || item.id || item })) : values.map((item) => ({ sid: item.sid || item.rowid || item.id || item }));
      setRecords((current) => current.map((item, index) => index === rowIndex ? { ...item, values: { ...item.values, [fieldId]: internal }, dirtyFields: item.dirtyFields.includes(fieldId) ? item.dirtyFields : [...item.dirtyFields, fieldId], cellErrors: { ...item.cellErrors, [fieldId]: undefined } } : item));
    } catch (error) { setMessage(`选择失败：${error?.message || "操作已取消"}`); }
  }

  async function save({ refresh = true } = {}) {
    setStatus("saving"); setMessage("正在保存…");
    const results = await saveDraftRows(records, adapters, gateway);
    const failed = new Map(results.filter((result) => !result.ok).map((result) => [result.key, result]));
    const successful = new Map(results.filter((result) => result.ok).map((result) => [result.key, result]));
    setRecords((current) => current.filter((row) => !row.isNew || failed.has(row.key) || successful.has(row.key)).map((row) => {
      const failedResult = failed.get(row.key); const successResult = successful.get(row.key);
      if (failedResult) return { ...row, cellErrors: failedResult.errors || row.cellErrors, saveStatus: "failed", saveError: failedResult.error };
      if (!successResult) return row;
      const savedFields = new Set(successResult.snapshot.dirtyFields || []);
      const changedDuringSave = [...savedFields].filter((fieldId) => JSON.stringify(row.values[fieldId]) !== JSON.stringify(successResult.snapshot.values[fieldId]));
      const remaining = row.dirtyFields.filter((fieldId) => !savedFields.has(fieldId) || changedDuringSave.includes(fieldId));
      const serverRow = successResult.row || {};
      return { ...row, rowId: row.rowId || rowIdOf(serverRow), isNew: false, serverSnapshot: { ...row.serverSnapshot, ...serverRow }, dirtyFields: remaining, saveStatus: remaining.length ? "idle" : "success", saveError: "" };
    }));
    setStatus(failed.size ? "failed" : "success"); setLastSave({ saved: results.length - failed.size, failed: failed.size });
    if (!failed.size && refresh) { clearDrafts(runtimeConfig); await load(); setMessage(`保存成功：${results.length} 行`); } else setMessage(`部分保存完成：${results.length - failed.size} 行成功，${failed.size} 行可重试`);
  }

  function discard() { clearDrafts(runtimeConfig); load(); setRefreshPending(false); setMessage("已放弃本标签页草稿"); }

  return <div className="excel-view">
    <header className="toolbar"><div><h1>批量录入</h1><span className="subtle">Excel 式视图 · 仅保存字段修改，不删除记录</span></div><div className="toolbar-actions"><span className={`status ${status}`}>{message}</span><button onClick={save} disabled={!hasDrafts || status === "saving"}>保存{lastSave ? ` (${lastSave.saved}${lastSave.failed ? `/${lastSave.failed}` : ""})` : ""}</button><button className="secondary" onClick={discard} disabled={!hasDrafts}>放弃草稿</button></div></header>
    {refreshPending && <div className="notice">检测到筛选或记录变化，但当前有未保存草稿。<button onClick={async () => { await save({ refresh: true }); setRefreshPending(false); }}>保存后刷新</button><button onClick={discard}>放弃后刷新</button><button onClick={() => setRefreshPending(false)}>暂不刷新</button></div>}
    {controls.length === 0 && status === "ready" && <div className="notice">当前运行时未提供 config.controls，已按记录字段生成临时列；发布到 HAP 后会自动使用真实字段配置。</div>}
    <div className="grid-shell"><DataEditor columns={columns.map((column) => ({ title: column.title || column.controlName || column.controlId, width: Math.max(130, Math.min(260, (column.title || "").length * 16 + 50)) }))} rows={records.length} getCellContent={getCellContent} onCellEdited={(cell, value) => applyCellChanges([{ rowIndex: cell[1], columnIndex: cell[0], input: value?.data ?? value }])} onPaste={onPaste} onFillPattern={onFillPattern} getCellsForSelection={getCellsForSelection} onCellActivated={selectForCell} fillHandle={true} rowMarkers="both" freezeColumns={0} freezeTrailingRows={0} allowedFillDirections="vertical" getRowTheme={() => undefined} /></div>
    <footer className="footer-hint">支持矩形复制、Excel 粘贴、纵向填充和 Delete 清空；成员/关联字段点击单元格调用明道云选择器。只读字段、公式、汇总和自动编号不可编辑。</footer>
  </div>;
}
