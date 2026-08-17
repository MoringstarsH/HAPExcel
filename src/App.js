import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { config } from "mdye";
import { createFieldAdapter, getControls, safeJson } from "./adapters";
import { buildPasteChanges, createClipboardPayload, GRID_CLIPBOARD_TYPE, readClipboardMatrix } from "./clipboard";
import { applyCommitResult, commitRows, validateRows } from "./commit";
import { clearDrafts, loadDrafts, saveDrafts } from "./drafts";
import { createGateway } from "./gateway";
import { createDraftRow, createServerRow, editRow, hasPendingChange, markDeleted, mergeRestoredDrafts, mergeServerPage, restoreDeleted } from "./rows";
import { containsCell, moveSelection, selectionRange } from "./selection";

const PAGE_SIZE = 100;
const MAX_CELLS = 5000;
const MAX_NEW_ROWS = 200;

function selectedKeys(raw) {
  const parsed = safeJson(raw, raw);
  if (!parsed) return [];
  return (Array.isArray(parsed) ? parsed : [parsed]).map((item) => typeof item === "object" ? item.key || item.id : item).filter(Boolean);
}

function sameCell(a, b) { return a?.column === b?.column && a?.row === b?.row; }

function CellInputEditor({ adapter, raw, onCommit, onCancel, onMove }) {
  const inputRef = useRef(null);
  const inputType = adapter.kind === "date" ? "date" : adapter.kind === "datetime" ? "datetime-local" : adapter.kind === "time" ? "time" : "text";
  const initial = adapter.kind === "datetime" ? String(raw || "").replace(" ", "T") : String(raw ?? "");
  const [value, setValue] = useState(initial);
  const finished = useRef(false);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select?.(); }, []);
  const commit = (movement) => {
    if (finished.current) return;
    finished.current = true;
    onCommit(value.replace("T", " "));
    if (movement) onMove(movement);
  };
  return <input
    ref={inputRef}
    className="cell-editor"
    type={inputType}
    inputMode={adapter.kind === "number" ? "decimal" : undefined}
    value={value}
    onChange={(event) => setValue(event.target.value)}
    onBlur={() => commit()}
    onPointerDown={(event) => event.stopPropagation()}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); finished.current = true; onCancel(); }
      else if (event.key === "Enter") { event.preventDefault(); commit({ column: 0, row: event.shiftKey ? -1 : 1 }); }
      else if (event.key === "Tab") { event.preventDefault(); commit({ column: event.shiftKey ? -1 : 1, row: 0 }); }
    }}
  />;
}

function ChoicePopover({ picker, adapter, value, onApply, onClose }) {
  const multiple = adapter.kind === "multiSelect";
  const [keys, setKeys] = useState(() => selectedKeys(value));
  function choose(key) {
    if (!multiple) {
      onApply([key]);
      onClose();
      return;
    }
    setKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }
  return <>
    <button type="button" className="popover-scrim" aria-label="关闭选项" onClick={onClose} />
    <div className="choice-popover" style={{ left: picker.left, top: picker.top }}>
      <div className="choice-title">{adapter.control.controlName || "选择选项"}</div>
      <button type="button" className="choice-option clear" onClick={() => { onApply([]); onClose(); }}>清空</button>
      <div className="choice-options">
        {adapter.options.map((option) => {
          const checked = keys.includes(option.key);
          return <button type="button" className={`choice-option ${checked ? "selected" : ""}`} key={option.key} onClick={() => choose(option.key)}>
            <span className="choice-check">{checked ? "✓" : ""}</span>
            <span>{option.value || option.name || option.key}</span>
          </button>;
        })}
      </div>
      {multiple && <div className="choice-footer"><button type="button" onClick={() => { onApply(keys); onClose(); }}>确定</button></div>}
    </div>
  </>;
}

export default function App() {
  const runtimeConfig = config || {};
  const controls = useMemo(() => getControls(runtimeConfig), [runtimeConfig]);
  const adapters = useMemo(() => controls.map(createFieldAdapter), [controls]);
  const gateway = useMemo(() => createGateway(runtimeConfig), [runtimeConfig.appId, runtimeConfig.worksheetId, runtimeConfig.viewId]);
  const gridRef = useRef(null);
  const pageRef = useRef(1);
  const requestRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const loadedServerCountRef = useRef(0);
  const filtersRef = useRef();
  const saveTimer = useRef(null);
  const draggingRef = useRef(false);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadState, setLoadState] = useState("loading");
  const [message, setMessage] = useState("正在加载记录…");
  const [selectedRows, setSelectedRows] = useState([]);
  const [cellSelection, setCellSelection] = useState(null);
  const [editingCell, setEditingCell] = useState(null);
  const [picker, setPicker] = useState(null);
  const [refreshPending, setRefreshPending] = useState(false);
  const [columnWidths, setColumnWidths] = useState({});
  const [saveProgress, setSaveProgress] = useState(null);
  const [hydrated, setHydrated] = useState(false);

  const columns = useMemo(() => controls.map((control) => {
    const title = `${control.controlName || control.controlId}${control.required ? " *" : ""}`;
    return {
      id: control.controlId,
      title,
      width: columnWidths[control.controlId] || Math.max(120, Math.min(260, title.length * 15 + 48)),
      grow: 0
    };
  }), [controls, columnWidths]);

  const pending = useMemo(() => rows.reduce((summary, row) => {
    if (!hasPendingChange(row)) return summary;
    if (row.state === "deleted") summary.deleted += 1;
    else if (!row.rowId) summary.added += 1;
    else summary.modified += 1;
    if (row.state === "error" || row.saveError || Object.keys(row.cellErrors || {}).length) summary.errors += 1;
    return summary;
  }, { added: 0, modified: 0, deleted: 0, errors: 0 }), [rows]);
  const hasDrafts = pending.added + pending.modified + pending.deleted > 0;
  const loadedCount = rows.filter((row) => row.rowId).length;

  const loadInitial = useCallback(async (filters) => {
    const request = ++requestRef.current;
    filtersRef.current = filters;
    setLoadState("loading");
    setMessage("正在加载记录…");
    setPicker(null);
    try {
      const [records, count] = await Promise.all([
        gateway.loadPage({ pageIndex: 1, pageSize: PAGE_SIZE, filters }),
        gateway.loadTotal(filters)
      ]);
      if (request !== requestRef.current) return;
      const serverRows = records.map((record) => createServerRow(record, controls));
      const restored = loadDrafts(runtimeConfig, controls);
      setRows(mergeRestoredDrafts(serverRows, restored.rows, controls));
      setTotal(count ?? (records.length < PAGE_SIZE ? records.length : null));
      setHasMore(count == null ? records.length === PAGE_SIZE : records.length < count);
      loadedServerCountRef.current = records.length;
      pageRef.current = 1;
      setLoadState("ready");
      setHydrated(true);
      if (restored.incompatible) setMessage("字段结构已变化，旧草稿未套用；放弃草稿后可清理");
      else if (restored.rows.length) setMessage(`已恢复 ${restored.rows.length} 条草稿${restored.migrated ? "（已升级）" : ""}`);
      else setMessage(`已加载 ${records.length} 条记录`);
    } catch (error) {
      if (request !== requestRef.current) return;
      setLoadState("failed");
      setMessage(`加载失败：${error?.message || "请检查视图权限或网络"}`);
    }
  }, [controls, gateway, runtimeConfig]);

  const loadNext = useCallback(async () => {
    if (!hasMore || loadingMoreRef.current || loadState !== "ready") return;
    loadingMoreRef.current = true;
    const nextPage = pageRef.current + 1;
    try {
      const records = await gateway.loadPage({ pageIndex: nextPage, pageSize: PAGE_SIZE, filters: filtersRef.current });
      setRows((current) => mergeServerPage(current, records, controls));
      pageRef.current = nextPage;
      loadedServerCountRef.current += records.length;
      const nextLoaded = loadedServerCountRef.current;
      setHasMore(total == null ? records.length === PAGE_SIZE : nextLoaded < total);
      setMessage(records.length ? `已加载到第 ${nextPage} 批` : "已加载全部记录");
    } catch (error) {
      setMessage(`继续加载失败：${error?.message || "请稍后重试"}`);
    } finally {
      loadingMoreRef.current = false;
    }
  }, [controls, gateway, hasMore, loadState, total]);

  useEffect(() => { loadInitial(); }, [loadInitial]);
  useEffect(() => gateway.on("filters-update", (filters) => {
    if (rows.some(hasPendingChange)) setRefreshPending(true);
    else loadInitial(filters);
  }), [gateway, loadInitial, rows]);
  useEffect(() => gateway.on("new-record", () => {
    if (rows.some(hasPendingChange)) setRefreshPending(true);
    else loadInitial(filtersRef.current);
  }), [gateway, loadInitial, rows]);
  useEffect(() => {
    if (!hydrated) return undefined;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveDrafts(runtimeConfig, controls, rows), 300);
    return () => clearTimeout(saveTimer.current);
  }, [controls, hydrated, rows, runtimeConfig]);

  const applyChanges = useCallback((changes) => {
    setRows((current) => {
      const next = [...current];
      changes.forEach(({ rowIndex, columnIndex, input, directValue, parsedValue, parsedError }) => {
        while (next.length <= rowIndex && next.filter((row) => !row.rowId).length < MAX_NEW_ROWS) next.push(createDraftRow(controls));
        const row = next[rowIndex];
        const adapter = adapters[columnIndex];
        if (!row || !adapter || row.state === "deleted") return;
        const parsed = parsedError !== undefined || parsedValue !== undefined
          ? { value: parsedValue, error: parsedError }
          : directValue !== undefined ? { value: directValue } : adapter.parseEditor(input);
        next[rowIndex] = editRow(row, adapter.control.controlId, parsed.value, parsed.error);
      });
      return next;
    });
  }, [adapters, controls]);

  const selectCell = useCallback((cell, extend = false) => {
    setEditingCell(null);
    setCellSelection((current) => ({ anchor: extend && current?.anchor ? current.anchor : cell, focus: cell }));
    gridRef.current?.focus?.({ preventScroll: true });
  }, []);

  const moveCellSelection = useCallback((column, row, extend = false) => {
    setCellSelection((current) => {
      const next = moveSelection(current, column, row, adapters.length, Math.max(1, rows.length), extend);
      setTimeout(() => document.querySelector(`[data-grid-row="${next.focus.row}"][data-grid-column="${next.focus.column}"]`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" }), 0);
      return next;
    });
    setEditingCell(null);
  }, [adapters.length, rows.length]);

  const copyCells = useCallback((event) => {
    if (!cellSelection || editingCell) return;
    const payload = createClipboardPayload(cellSelection, rows, adapters);
    if (!payload) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", payload.plain);
    try { event.clipboardData.setData(GRID_CLIPBOARD_TYPE, payload.structured); } catch (_) { /* plain TSV still works */ }
    const range = selectionRange(cellSelection);
    setMessage(`已复制 ${range.width * range.height} 个单元格`);
  }, [adapters, cellSelection, editingCell, rows]);

  const pasteCells = useCallback((event) => {
    if (!cellSelection || editingCell) return;
    event.preventDefault();
    const matrix = readClipboardMatrix(event.clipboardData.getData("text/plain"), event.clipboardData.getData(GRID_CLIPBOARD_TYPE));
    const result = buildPasteChanges({ matrix, selection: cellSelection, adapters, rowCount: rows.length, maxCells: MAX_CELLS, maxNewRows: MAX_NEW_ROWS });
    if (result.fatal) { setMessage(result.fatal); return; }
    applyChanges(result.changes);
    if (result.target) setCellSelection({ anchor: { column: result.target.left, row: result.target.top }, focus: { column: result.target.right, row: result.target.bottom } });
    setMessage(result.errors.length ? `已粘贴 ${result.changes.length - result.errors.length} 格，${result.errors.length} 格类型不匹配或只读` : `已粘贴 ${result.changes.length} 个单元格`);
  }, [adapters, applyChanges, cellSelection, editingCell, rows.length]);

  const activateCell = useCallback(async ([columnIndex, rowIndex], anchor) => {
    const row = rows[rowIndex];
    const adapter = adapters[columnIndex];
    if (!row || !adapter || !adapter.writable || row.state === "deleted") return;
    const fieldId = adapter.control.controlId;
    if (adapter.kind === "select" || adapter.kind === "multiSelect") {
      const bounds = anchor?.getBoundingClientRect?.();
      setPicker({ columnIndex, rowIndex, left: Math.max(8, bounds?.x || 16), top: Math.max(8, Math.min(window.innerHeight - 300, (bounds?.y || 40) + (bounds?.height || 36))) });
      return;
    }
    if (adapter.kind !== "member" && adapter.kind !== "relation") return;
    try {
      const selected = adapter.kind === "member"
        ? await gateway.selectUsers(adapter.control)
        : await gateway.selectRelation(adapter.control);
      if (!selected || (Array.isArray(selected) && !selected.length)) return;
      const list = Array.isArray(selected) ? selected : [selected];
      const unique = Number(adapter.control.enumDefault) === 1 || Number(adapter.control.subType) === 1;
      const value = adapter.kind === "member"
        ? (unique ? list.slice(0, 1) : list).map((item) => ({ ...item, accountId: item.accountId || item.id || item }))
        : (unique ? list.slice(0, 1) : list).map((item) => ({ ...item, sid: item.sid || item.rowid || item.id || item }));
      applyChanges([{ rowIndex, columnIndex, directValue: value }]);
    } catch (error) {
      setMessage(`选择失败：${error?.message || "操作已取消"}`);
    }
  }, [adapters, applyChanges, gateway, rows]);

  const beginEdit = useCallback((cell, anchor) => {
    const row = rows[cell.row];
    const adapter = adapters[cell.column];
    if (!row || !adapter || !adapter.writable || row.state === "deleted") return;
    if (["select", "multiSelect", "member", "relation"].includes(adapter.kind)) {
      activateCell([cell.column, cell.row], anchor);
      return;
    }
    if (adapter.kind === "checkbox") {
      applyChanges([{ rowIndex: cell.row, columnIndex: cell.column, directValue: !Boolean(row.values[adapter.control.controlId]) }]);
      return;
    }
    setEditingCell(cell);
  }, [activateCell, adapters, applyChanges, rows]);

  const handleGridKeyDown = useCallback((event) => {
    if (editingCell || !cellSelection) return;
    const keyMoves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (keyMoves[event.key]) {
      event.preventDefault();
      moveCellSelection(keyMoves[event.key][0], keyMoves[event.key][1], event.shiftKey);
    } else if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      const cell = cellSelection.focus;
      beginEdit(cell, document.querySelector(`[data-grid-row="${cell.row}"][data-grid-column="${cell.column}"]`));
    }
  }, [beginEdit, cellSelection, editingCell, moveCellSelection]);

  const handleGridPointerMove = useCallback((event) => {
    if (!draggingRef.current) return;
    const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest?.("td[data-grid-row]");
    if (cell) setCellSelection((current) => current ? { ...current, focus: { column: Number(cell.dataset.gridColumn), row: Number(cell.dataset.gridRow) } } : current);
    const container = gridRef.current;
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    const edge = 36;
    if (event.clientY < bounds.top + edge) container.scrollTop -= 24;
    else if (event.clientY > bounds.bottom - edge) container.scrollTop += 24;
    if (event.clientX < bounds.left + edge) container.scrollLeft -= 24;
    else if (event.clientX > bounds.right - edge) container.scrollLeft += 24;
  }, []);

  useEffect(() => {
    const stopDragging = () => { draggingRef.current = false; };
    window.addEventListener("pointermove", handleGridPointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
      window.removeEventListener("pointermove", handleGridPointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [handleGridPointerMove]);

  function addRow() {
    const draft = createDraftRow(controls);
    const rowIndex = rows.length;
    setRows((current) => [...current, draft]);
    const firstWritable = Math.max(0, adapters.findIndex((adapter) => adapter.writable));
    setCellSelection({ anchor: { column: firstWritable, row: rowIndex }, focus: { column: firstWritable, row: rowIndex } });
    setTimeout(() => document.querySelector(`[data-row-key="${draft.key}"] [data-grid-column="${firstWritable}"]`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" }), 0);
    setMessage("已新增一条草稿行");
  }

  function toggleDeleteSelected() {
    const indices = selectedRows.filter((index) => rows[index]);
    if (!indices.length) { setMessage("请先勾选要删除的行"); return; }
    const allDeleted = indices.every((index) => rows[index].state === "deleted");
    setRows((current) => {
      if (allDeleted) return current.map((row, index) => indices.includes(index) ? restoreDeleted(row) : row);
      return current.flatMap((row, index) => {
        if (!indices.includes(index)) return [row];
        const deleted = markDeleted(row);
        return deleted ? [deleted] : [];
      });
    });
    setSelectedRows([]);
    setMessage(allDeleted ? "已撤销待删除标记" : "已标记待删除；保存后才会删除服务端记录");
  }

  async function save() {
    if (!hasDrafts || loadState === "saving") return;
    const errors = validateRows(rows, adapters);
    if (errors.size) {
      setRows((current) => current.map((row) => errors.has(row.key) ? { ...row, cellErrors: errors.get(row.key), state: "error", saveError: "请修正字段错误" } : row));
      setMessage(`有 ${errors.size} 行校验失败，请先修正红色单元格`);
      return;
    }
    const summary = [pending.added && `新增 ${pending.added}`, pending.modified && `修改 ${pending.modified}`, pending.deleted && `删除 ${pending.deleted}`].filter(Boolean).join("、");
    if (!window.confirm(`确认提交：${summary}？\n删除操作提交后不可由本表格撤销。`)) return;
    setLoadState("saving");
    setMessage("正在保存草稿…");
    setSaveProgress({ completed: 0, total: pending.added + pending.modified + pending.deleted });
    const result = await commitRows(rows, adapters, gateway, (progress) => {
      setSaveProgress(progress);
      setMessage(progress.phase === "delete" ? "正在删除记录…" : `正在保存 ${progress.completed}/${progress.total}…`);
    });
    const next = applyCommitResult(rows, result);
    const failedWrites = result.writes.filter((entry) => !entry.ok).length;
    const failed = failedWrites + (result.deletion && !result.deletion.ok ? result.deletion.rowIds.length : 0);
    setRows(next);
    setSaveProgress(null);
    if (!failed && !result.deleteSkipped) {
      clearDrafts(runtimeConfig);
      setMessage("保存成功，正在刷新…");
      await loadInitial(filtersRef.current);
      setMessage(`保存成功：${summary}`);
    } else {
      setLoadState("ready");
      setMessage(result.deleteSkipped
        ? `部分保存完成：${failedWrites} 行失败，删除已暂缓；修正后可重试`
        : `部分保存完成：${failed} 项失败，可直接重试`);
    }
  }

  function discard() {
    if (hasDrafts && !window.confirm("确认放弃全部未保存的新增、修改和删除草稿？")) return;
    clearDrafts(runtimeConfig);
    setRefreshPending(false);
    loadInitial(filtersRef.current);
  }

  const selectedAllDeleted = selectedRows.length > 0 && selectedRows.every((index) => rows[index]?.state === "deleted");
  const pickerAdapter = picker ? adapters[picker.columnIndex] : null;
  const pickerRow = picker ? rows[picker.rowIndex] : null;

  return <div className="table-app">
    <header className="table-toolbar">
      <div className="toolbar-primary">
        <button type="button" className="add-button" onClick={addRow} disabled={loadState === "saving"}><span>＋</span> 新增记录</button>
        <button type="button" className="ghost-button" onClick={toggleDeleteSelected} disabled={!selectedRows.length || loadState === "saving"}>
          {selectedAllDeleted ? "撤销删除" : "删除所选"}
        </button>
      </div>
      <div className="toolbar-status" title={message}>
        {hasDrafts && <span className="draft-count">新增 {pending.added} · 修改 {pending.modified} · 删除 {pending.deleted}{pending.errors ? ` · 错误 ${pending.errors}` : ""}</span>}
        <span className={loadState === "failed" ? "status-error" : ""}>{message}</span>
      </div>
      <div className="toolbar-actions">
        <button type="button" className="ghost-button" onClick={discard} disabled={!hasDrafts && !refreshPending}>放弃草稿</button>
        <button type="button" className="save-button" onClick={save} disabled={!hasDrafts || loadState === "saving"}>
          {loadState === "saving" ? `保存中${saveProgress?.total ? ` ${saveProgress.completed}/${saveProgress.total}` : "…"}` : "保存"}
        </button>
      </div>
    </header>

    {refreshPending && <div className="notice-bar">
      <span>数据或筛选条件已变化，当前草稿尚未保存。</span>
      <button type="button" onClick={save}>保存草稿</button>
      <button type="button" onClick={discard}>放弃并刷新</button>
      <button type="button" onClick={() => setRefreshPending(false)}>暂不刷新</button>
    </div>}

    <main className="grid-shell">
      {loadState === "failed" && !rows.length
        ? <div className="state-panel"><strong>无法加载表格</strong><span>{message}</span><button type="button" onClick={() => loadInitial(filtersRef.current)}>重试</button></div>
        : controls.length === 0
          ? <div className="state-panel"><strong>没有可显示字段</strong><span>当前运行时没有提供视图字段配置，请检查自定义视图配置。</span></div>
          : <div className="native-grid-scroll" ref={gridRef} tabIndex={0} role="grid" aria-multiselectable="true"
            onKeyDown={handleGridKeyDown} onCopy={copyCells} onPaste={pasteCells} onPointerMove={handleGridPointerMove}
            onScroll={(event) => {
              const el = event.currentTarget;
              if (el.scrollTop + el.clientHeight >= el.scrollHeight - 500) loadNext();
            }}>
              <table className="native-grid">
                <thead><tr>
                  <th className="row-marker"><input type="checkbox" aria-label="选择全部记录" checked={rows.length > 0 && selectedRows.length === rows.length} onChange={(event) => setSelectedRows(event.target.checked ? rows.map((_, index) => index) : [])} /></th>
                  {columns.map((column) => <th key={column.id} style={{ width: column.width, minWidth: column.width }}>{column.title}</th>)}
                </tr></thead>
                <tbody>{rows.map((row, rowIndex) => <tr key={row.key} data-row-key={row.key} className={`row-${row.state}`}>
                  <td className="row-marker"><input type="checkbox" aria-label={`选择第 ${rowIndex + 1} 行`} checked={selectedRows.includes(rowIndex)} onChange={(event) => setSelectedRows((current) => event.target.checked ? [...new Set([...current, rowIndex])] : current.filter((item) => item !== rowIndex))} /><span>{rowIndex + 1}</span></td>
                  {adapters.map((adapter, columnIndex) => {
                    const fieldId = adapter.control.controlId;
                    const raw = row.values[fieldId];
                    const disabled = !adapter.writable || row.state === "deleted";
                    const error = row.cellErrors[fieldId];
                    const cell = { column: columnIndex, row: rowIndex };
                    const active = sameCell(cellSelection?.focus, cell);
                    const selected = containsCell(cellSelection, columnIndex, rowIndex);
                    const editing = sameCell(editingCell, cell);
                    const display = adapter.kind === "checkbox" ? (raw ? "✓" : "") : adapter.display(raw);
                    return <td
                      key={fieldId}
                      data-grid-row={rowIndex}
                      data-grid-column={columnIndex}
                      role="gridcell"
                      aria-selected={selected}
                      aria-readonly={disabled}
                      className={[error && "cell-error", selected && "cell-selected", active && "cell-active", editing && "cell-editing", disabled && "cell-disabled"].filter(Boolean).join(" ")}
                      title={error || display}
                      onPointerDown={(event) => {
                        if (event.button !== 0 || editing) return;
                        event.preventDefault();
                        draggingRef.current = true;
                        selectCell(cell, event.shiftKey);
                      }}
                      onDoubleClick={(event) => { event.preventDefault(); beginEdit(cell, event.currentTarget); }}
                    >
                      {editing
                        ? <CellInputEditor
                            adapter={adapter}
                            raw={raw}
                            onCommit={(input) => { applyChanges([{ rowIndex, columnIndex, input }]); setEditingCell(null); }}
                            onCancel={() => setEditingCell(null)}
                            onMove={(movement) => {
                              setCellSelection((current) => moveSelection(current, movement.column, movement.row, adapters.length, Math.max(1, rows.length), false));
                              setEditingCell(null);
                            }}
                          />
                        : <div className={`cell-display kind-${adapter.kind}`}>
                            {display || (!disabled && ["select", "multiSelect", "member", "relation"].includes(adapter.kind) ? <span className="cell-placeholder">请选择</span> : "")}
                          </div>}
                      {error && <small>{error}</small>}
                    </td>;
                  })}
                </tr>)}</tbody>
              </table>
              <button type="button" className="append-row" onClick={addRow}>＋ 新增记录</button>
            </div>}
      {loadState === "loading" && <div className="loading-overlay"><span className="spinner" />正在加载表格…</div>}
    </main>

    <footer className="table-footer">
      <span>{total == null ? `已加载 ${loadedCount} 条` : `已加载 ${loadedCount} / 共 ${total} 条`}{hasMore ? " · 向下滚动继续加载" : " · 已全部加载"}</span>
      <span>拖拽或 Shift 扩展选区 · Ctrl/Cmd+C/V 批量复制粘贴 · Enter/F2 编辑</span>
    </footer>

    {picker && pickerAdapter && pickerRow && <ChoicePopover
      picker={picker}
      adapter={pickerAdapter}
      value={pickerRow.values[pickerAdapter.control.controlId]}
      onApply={(value) => applyChanges([{ rowIndex: picker.rowIndex, columnIndex: picker.columnIndex, directValue: value }])}
      onClose={() => setPicker(null)}
    />}
  </div>;
}
