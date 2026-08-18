import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { config, env } from "mdye";
import { createFieldAdapter, getControls, safeJson } from "./adapters";
import { buildPasteChanges, createClipboardPayload, GRID_CLIPBOARD_TYPE, readClipboardMatrix } from "./clipboard";
import { hiddenErrorFieldNames, resolveVisibleControls } from "./columns";
import { applyCommitResult, commitRows, commitSummary, normalizeOptionalFieldErrors, validateRows } from "./commit";
import { clearDrafts, loadDrafts, saveDrafts } from "./drafts";
import { createGateway, rowIdOf } from "./gateway";
import { canRedo, canUndo, createHistoryState, historyReducer } from "./history";
import { createDraftRow, createServerRow, editRow, hasPendingChange, markDeleted, mergeQueriedRows, mergeRestoredDrafts, mergeServerPage, rebaseRowFromServer, restoreDeleted } from "./rows";
import { clampCell, containsCell, moveSelection, selectionRange } from "./selection";
import { buildClearChanges } from "./clear";
import { buildReplaceChanges, buildValueChanges, filteredRowIndexes, targetRowsForColumn } from "./batch";
import { buildFillChanges, fillPreviewMap } from "./fill";
import { clampColumnWidth, clampRowHeight, DEFAULT_ROW_HEIGHT, gridWidthOf, layoutNeedsMigration, migrateRowHeights, normalizeLayout, ROW_MARKER_WIDTH } from "./layout";
import { buildNativeFilter, defaultFilterForControl, filterMapToList, filterOptionsForControl, mergeQueryParams } from "./query";
import { AttachmentDisplay, EntityTags, LocationDisplay, NumberDisplay } from "./FieldDisplays";
import { diagnostics } from "./diagnostics";
import { scrollVelocity } from "./autoScroll";
import { virtualWindow as calculateVirtualWindow } from "./virtualization";

const PAGE_SIZE = 100;
const MAX_CELLS = 5000;
const MAX_NEW_ROWS = 200;
const VIRTUALIZE_AFTER = 300;
const VIRTUAL_BUFFER = 30;

function selectedKeys(raw) {
  const parsed = safeJson(raw, raw);
  if (!parsed) return [];
  return (Array.isArray(parsed) ? parsed : [parsed]).map((item) => typeof item === "object" ? item.key || item.id : item).filter(Boolean);
}

function sameCell(a, b) { return a?.column === b?.column && a?.row === b?.row; }

function saveSummaryText(summary) {
  const parts = [];
  for (const operation of ["add", "update", "delete"]) {
    const label = operation === "add" ? "新增" : operation === "update" ? "修改" : "删除";
    const item = summary[operation];
    if (item.success) parts.push(`${label}成功 ${item.success}`);
    if (item.failed) parts.push(`${label}失败 ${item.failed}`);
    if (item.unknown) parts.push(`${label}待核对 ${item.unknown}`);
    if (item.skipped) parts.push(`${label}暂缓 ${item.skipped}`);
  }
  if (summary.cancelled) parts.push(`待处理 ${summary.cancelled}`);
  return parts.join("，") || "没有可提交操作";
}

function filterValueText(value) {
  if (Array.isArray(value)) return value.join(", ");
  return String(value ?? "");
}

function FieldFilterForm({ control, adapter, initial, onApply, onClear }) {
  const options = filterOptionsForControl(control);
  const first = initial || defaultFilterForControl(control);
  const [operator, setOperator] = useState(first.operator || options[0]?.key || "contains");
  const [value, setValue] = useState(first.value ?? "");
  const selectedOption = options.find((item) => item.key === operator) || options[0];
  const mode = selectedOption?.valueMode || "text";
  const choiceOptions = adapter?.options || [];
  const selectedChoices = Array.isArray(value) ? value : [];
  const toggleChoice = (key) => setValue((current) => {
    const values = Array.isArray(current) ? current : [];
    return values.includes(key) ? values.filter((item) => item !== key) : [...values, key];
  });

  function renderValueEditor() {
    if (mode === "none") return <div className="filter-empty-hint">无需填写筛选值</div>;
    if (mode === "choices") return <div className="filter-choice-list">
      {choiceOptions.map((option) => <label key={option.key} className="filter-choice-item">
        <input type="checkbox" checked={selectedChoices.includes(option.key)} onChange={() => toggleChoice(option.key)} />
        <span>{option.value || option.label || option.key}</span>
      </label>)}
      {!choiceOptions.length && <input className="filter-input" value={filterValueText(value)} onChange={(event) => setValue(event.target.value.split(/[,，、]/).map((item) => item.trim()).filter(Boolean))} placeholder="输入选项 key，逗号分隔" />}
    </div>;
    if (mode === "range") return <div className="filter-range-inputs">
      <input className="filter-input" type={control.type === 6 || control.type === 8 ? "number" : "date"} value={Array.isArray(value) ? value[0] || "" : ""} onChange={(event) => setValue([event.target.value, Array.isArray(value) ? value[1] || "" : ""])} placeholder="最小值" />
      <span>至</span>
      <input className="filter-input" type={control.type === 6 || control.type === 8 ? "number" : "date"} value={Array.isArray(value) ? value[1] || "" : ""} onChange={(event) => setValue([Array.isArray(value) ? value[0] || "" : "", event.target.value])} placeholder="最大值" />
    </div>;
    if (mode === "boolean") return <select className="filter-input" value={value === true || value === 1 ? "1" : "0"} onChange={(event) => setValue(event.target.value === "1")}>
      <option value="1">是</option><option value="0">否</option>
    </select>;
    return <input
      className="filter-input"
      type={mode === "number" ? "number" : mode === "date" ? (Number(control.type) === 16 ? "datetime-local" : "date") : "text"}
      value={filterValueText(value)}
      onChange={(event) => setValue(event.target.value)}
      placeholder={mode === "relation" ? "输入记录 ID，逗号分隔" : "请输入筛选值"}
    />;
  }

  return <div className="field-filter-form">
    <label className="filter-label">筛选条件<select className="filter-input" value={operator} onChange={(event) => { setOperator(event.target.value); setValue(""); }}>
      {options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
    </select></label>
    {renderValueEditor()}
    <div className="filter-actions">
      <button type="button" className="ghost-button" onClick={onClear}>清除</button>
      <button type="button" className="menu-primary" onClick={() => onApply({ operator, value })}>应用</button>
    </div>
  </div>;
}

function ColumnMenu({ column, control, adapter, position, queryFilter, sortId, isAsc, onSort, onFilter, onClearFilter, onClose }) {
  const [mode, setMode] = useState("menu");
  const sorted = sortId === control.controlId;
  return <>
    <button type="button" className="popover-scrim" aria-label="关闭字段菜单" onClick={onClose} />
    <div className="column-menu" style={{ left: position.left, top: position.top }} onPointerDown={(event) => event.stopPropagation()}>
      <div className="column-menu-title">{column.title}</div>
      {mode === "menu"
        ? <>
          <button type="button" className={`column-menu-item ${sorted && isAsc ? "active" : ""}`} onClick={() => onSort(control.controlId, true)}>↥ 升序排序</button>
          <button type="button" className={`column-menu-item ${sorted && !isAsc ? "active" : ""}`} onClick={() => onSort(control.controlId, false)}>↧ 降序排序</button>
          <button type="button" className="column-menu-item" disabled={!sorted} onClick={() => onSort("", true)}>取消排序</button>
          <div className="column-menu-divider" />
          <button type="button" className={`column-menu-item ${queryFilter ? "active" : ""}`} onClick={() => setMode("filter")}>⌕ 筛选{queryFilter ? "（已设置）" : ""}</button>
        </>
        : <FieldFilterForm
            control={control}
            adapter={adapter}
            initial={queryFilter}
            onApply={(next) => { onFilter(control.controlId, next); onClose(); }}
            onClear={() => { onClearFilter(control.controlId); onClose(); }}
          />}
    </div>
  </>;
}

function ContextMenu({ position, onAction, onClose }) {
  const items = [
    ["copy", "复制"], ["cut", "剪切"], ["clear", "清空"], ["paste", "粘贴"],
    ["pasteSkipEmpty", "选择性粘贴：跳过空值"], ["pasteFillBlank", "选择性粘贴：仅填空白"],
    ["undo", "撤销"], ["redo", "重做"], ["set", "批量设置当前字段"],
    ["replace", "批量替换"], ["fill", "复制式填充"], ["series", "序列填充"],
    ["fillBlank", "仅填充空白"], ["column", "整列批量赋值"], ["condition", "按当前筛选条件修改"]
  ];
  return <>
    <button type="button" className="popover-scrim" aria-label="关闭右键菜单" onClick={onClose} />
    <div className="context-menu column-menu" role="menu" aria-label="单元格操作菜单" style={{ left: position.left, top: position.top }} onPointerDown={(event) => event.stopPropagation()}>
      {items.map(([key, label]) => <button key={key} type="button" role="menuitem" className="column-menu-item" onClick={() => { onAction(key); onClose(); }}>{label}</button>)}
    </div>
  </>;
}

function rowIndexAtPoint(event, container) {
  const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest?.("td[data-grid-row]");
  if (cell) return Number(cell.dataset.gridRow);
  if (!container) return null;
  const cells = [...container.querySelectorAll("td[data-grid-row]")];
  if (!cells.length) return null;
  const byRow = new Map(cells.map((item) => [Number(item.dataset.gridRow), item]));
  const rowIndexes = [...byRow.keys()].sort((a, b) => a - b);
  const firstRow = rowIndexes[0];
  const lastRow = rowIndexes[rowIndexes.length - 1];
  const first = byRow.get(firstRow)?.getBoundingClientRect?.();
  const last = byRow.get(lastRow)?.getBoundingClientRect?.();
  const rowHeight = Math.max(1, Number(first?.height || last?.height || 38));
  if (last && event.clientY > last.bottom) return lastRow + Math.max(1, Math.ceil((event.clientY - last.bottom) / rowHeight));
  if (first && event.clientY < first.top) return Math.max(0, firstRow - Math.ceil((first.top - event.clientY) / rowHeight));
  return null;
}

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
  const input = <input
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
  const number = adapter.kind === "number" ? adapter.numberPresentation(raw) : null;
  return number ? <div className={`number-editor-shell ${number.percentage ? "number-percentage" : ""}`}>
    {number.prefix && <span className="number-prefix">{number.prefix}</span>}
    {input}
    {number.suffix && <span className="number-suffix">{number.suffix}</span>}
  </div> : input;
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
          const presentation = adapter.optionTag(option.key);
          return <button type="button" className={`choice-option ${checked ? "selected" : ""}`} key={option.key} onClick={() => choose(option.key)}>
            <span className="choice-check">{checked ? "✓" : ""}</span>
            <span className={`choice-option-color ${presentation.colored ? "" : "choice-option-color-neutral"}`} style={presentation.color ? { "--option-color": presentation.color } : undefined} />
            <span>{presentation.label}</span>
          </button>;
        })}
      </div>
      {multiple && <div className="choice-footer"><button type="button" onClick={() => { onApply(keys); onClose(); }}>确定</button></div>}
    </div>
  </>;
}

function RelationDisplay({ links, fallback, canOpen, onOpen }) {
  if (!links.length) return fallback;
  return <span className="relation-tags">
    {links.map((link, index) => {
      const clickable = canOpen && Boolean(link.recordId);
      return clickable
        ? <button
            type="button"
            className="relation-tag relation-link"
            key={`${link.recordId}-${index}`}
            title={`打开关联记录：${link.label}`}
            aria-label={`打开关联记录：${link.label}`}
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); onOpen(link); }}
          >{link.label}</button>
        : <span className="relation-tag" key={`${link.label}-${index}`}>{link.label}</span>;
    })}
  </span>;
}

function OptionTags({ tags }) {
  if (!tags.length) return null;
  return <span className="option-tags">
    {tags.map((tag, index) => <span
      className={`option-tag ${tag.colored ? "" : "option-tag-neutral"}`}
      key={`${tag.key}-${index}`}
      style={tag.color ? { "--option-color": tag.color } : undefined}
      title={tag.label}
    >{tag.label}</span>)}
  </span>;
}

function MemberAvatar({ member }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [member.avatar]);
  if (member.avatar && !failed) {
    return <img className="member-avatar" src={member.avatar} alt="" aria-hidden="true" onError={() => setFailed(true)} />;
  }
  return <span className="member-avatar member-avatar-fallback" style={{ "--member-color": member.color }} aria-hidden="true">{member.initials}</span>;
}

function MemberTags({ tags }) {
  if (!tags.length) return null;
  return <span className="member-tags">
    {tags.map((member, index) => <span
      className="member-tag"
      key={`${member.accountId || member.fullname}-${index}`}
      title={member.fullname}
      aria-label={member.fullname}
    >
      <MemberAvatar member={member} />
      <span className="member-name">{member.fullname}</span>
    </span>)}
  </span>;
}

export default function App() {
  const runtimeConfig = config || {};
  const allControls = useMemo(() => getControls(runtimeConfig), [runtimeConfig]);
  const columnConfig = useMemo(() => resolveVisibleControls({
    controls: allControls,
    view: runtimeConfig.view,
    showFields: env?.showFields
  }), [allControls, runtimeConfig.view]);
  const controls = columnConfig.controls;
  const allAdapters = useMemo(() => allControls.map(createFieldAdapter), [allControls]);
  const adapters = useMemo(() => controls.map(createFieldAdapter), [controls]);
  const gateway = useMemo(() => createGateway(runtimeConfig), [runtimeConfig.appId, runtimeConfig.projectId, runtimeConfig.worksheetId, runtimeConfig.viewId]);
  const gridRef = useRef(null);
  const pageRef = useRef(1);
  const requestRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const loadedServerCountRef = useRef(0);
  const filtersRef = useRef();
  const externalFiltersRef = useRef({});
  const queryRef = useRef({ sortId: "", isAsc: true, filterMap: {} });
  const rowsRef = useRef([]);
  const hydratedRef = useRef(false);
  const saveTimer = useRef(null);
  const draggingRef = useRef(false);
  const fillDragRef = useRef(null);
  const columnResizeRef = useRef(null);
  const rowResizeRef = useRef(null);
  const layoutSaveTimer = useRef(null);
  const layoutSaveArmedRef = useRef(false);
  const layoutMigrationPendingRef = useRef(false);
  const latestLayoutRef = useRef({ columnWidths: {}, defaultRowHeight: DEFAULT_ROW_HEIGHT, rowHeights: {} });
  const layoutDirtyRef = useRef(false);
  const layoutRevisionRef = useRef(0);
  const commitLockRef = useRef(false);
  const activeCommitRef = useRef("");
  const commitAbortRef = useRef(null);
  const autoScrollRef = useRef({ frame: 0, x: 0, y: 0, clientX: 0, clientY: 0 });
  const [rowHistory, dispatchRows] = useReducer(historyReducer, [], createHistoryState);
  const rows = rowHistory.value;
  const setRows = useCallback((update, options = {}) => {
    dispatchRows({
      type: options.record ? "apply" : "replace",
      update: typeof update === "function" ? update : undefined,
      value: typeof update === "function" ? undefined : update,
      label: options.label,
      clearHistory: options.clearHistory,
      rebaseHistory: options.rebaseHistory
    });
  }, []);
  const undoRows = useCallback(() => dispatchRows({ type: "undo" }), []);
  const redoRows = useCallback(() => dispatchRows({ type: "redo" }), []);
  const [total, setTotal] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadState, setLoadState] = useState("loading");
  const [message, setMessage] = useState("正在加载记录…");
  const [selectedRows, setSelectedRows] = useState([]);
  const [cellSelection, setCellSelection] = useState(null);
  const [editingCell, setEditingCell] = useState(null);
  const [fillDrag, setFillDrag] = useState(null);
  const [picker, setPicker] = useState(null);
  const [refreshPending, setRefreshPending] = useState(false);
  const [columnWidths, setColumnWidths] = useState({});
  const [rowHeights, setRowHeights] = useState({});
  const [defaultRowHeight, setDefaultRowHeight] = useState(DEFAULT_ROW_HEIGHT);
  const [layoutReady, setLayoutReady] = useState(false);
  const [layoutStatus, setLayoutStatus] = useState("");
  const [columnMenu, setColumnMenu] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [resizing, setResizing] = useState(null);
  const [queryState, setQueryState] = useState({ sortId: "", isAsc: true, filterMap: {} });
  const [saveProgress, setSaveProgress] = useState(null);
  const [hydrated, setHydrated] = useState(false);
  const [online, setOnline] = useState(() => globalThis.navigator?.onLine !== false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnosticEntries, setDiagnosticEntries] = useState(() => diagnostics.list());
  const [virtualScrollTop, setVirtualScrollTop] = useState(0);
  const hydratingRelationsRef = useRef(new Set());

  rowsRef.current = rows;
  hydratedRef.current = hydrated;
  queryRef.current = queryState;
  latestLayoutRef.current = { columnWidths, defaultRowHeight, rowHeights };

  useEffect(() => {
    if (rowHistory.conflict) setMessage("撤销已取消：数据已被外部刷新");
    else if (rowHistory.lastUndoLabel) setMessage(`已撤销：${rowHistory.lastUndoLabel}`);
    else if (rowHistory.lastRedoLabel) setMessage(`已重做：${rowHistory.lastRedoLabel}`);
  }, [rowHistory.conflict, rowHistory.lastRedoLabel, rowHistory.lastUndoLabel]);

  useEffect(() => diagnostics.subscribe(setDiagnosticEntries), []);
  useEffect(() => {
    const observer = typeof PerformanceObserver === "function" ? new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => diagnostics.info("performance.longtask", { durationMs: Math.round(entry.duration), startMs: Math.round(entry.startTime) }));
    }) : null;
    try { observer?.observe({ type: "longtask", buffered: true }); } catch (_) { /* browser may not support longtask */ }
    return () => observer?.disconnect();
  }, []);

  useEffect(() => {
    setSelectedRows((current) => {
      const available = new Set(rows.map((row) => row.key));
      const next = current.filter((key) => available.has(key));
      return next.length === current.length ? current : next;
    });
    setCellSelection((current) => {
      if (!current || !rows.length || !adapters.length) return rows.length && adapters.length ? current : null;
      const anchor = clampCell(current.anchor, adapters.length, rows.length);
      const focus = clampCell(current.focus, adapters.length, rows.length);
      return sameCell(anchor, current.anchor) && sameCell(focus, current.focus) ? current : { anchor, focus };
    });
  }, [adapters.length, rows]);

  useEffect(() => {
    if (!hydrated) return;
    const pending = [];
    rows.forEach((row, rowIndex) => {
      allAdapters.forEach((adapter) => {
        if (adapter.kind !== "relation") return;
        const fieldId = adapter.control.controlId;
        const items = adapter.relationLinks(row.values[fieldId]);
        items.forEach((link, itemIndex) => {
          if (!link.recordId || link.label !== "正在获取标题…") return;
          const key = `${row.clientId}:${fieldId}:${itemIndex}:${link.recordId}`;
          if (hydratingRelationsRef.current.has(key)) return;
          hydratingRelationsRef.current.add(key);
          pending.push(gateway.hydrateRelation(adapter.control, link.raw).then((relation) => ({ rowIndex, fieldId, itemIndex, relation, key })));
        });
      });
    });
    if (!pending.length) return;
    let cancelled = false;
    Promise.all(pending).then((results) => {
      results.forEach(({ key }) => hydratingRelationsRef.current.delete(key));
      if (cancelled) return;
      setRows((current) => current.map((row, rowIndex) => {
        const updates = results.filter((item) => item.rowIndex === rowIndex);
        if (!updates.length) return row;
        const values = { ...row.values };
        const originalValues = { ...row.originalValues };
        updates.forEach(({ fieldId, itemIndex, relation }) => {
          const currentItems = Array.isArray(values[fieldId]) ? [...values[fieldId]] : safeJson(values[fieldId], []);
          currentItems[itemIndex] = relation;
          values[fieldId] = currentItems;
          if (!row.dirtyFields?.includes(fieldId)) {
            const originals = Array.isArray(originalValues[fieldId]) ? [...originalValues[fieldId]] : safeJson(originalValues[fieldId], []);
            if (originals[itemIndex]) originals[itemIndex] = relation;
            originalValues[fieldId] = originals;
          }
        });
        return { ...row, values, originalValues };
      }), { rebaseHistory: true });
    });
    return () => { cancelled = true; };
  }, [allAdapters, gateway, hydrated, rows]);

  const columns = useMemo(() => controls.map((control, index) => {
    const title = `${control.controlName || control.controlId}${control.required ? " *" : ""}`;
    const adapter = adapters[index];
    const number = adapter?.numberPresentation?.(0);
    const numberWidth = number ? 150 + Math.min(48, ((number.prefix?.length || 0) + (number.suffix?.length || 0)) * 12) : 0;
    return {
      id: control.controlId,
      title,
      width: columnWidths[control.controlId] || clampColumnWidth(Math.max(numberWidth, Math.min(260, title.length * 15 + 48))),
      grow: 0
    };
  }), [adapters, controls, columnWidths]);
  const tableWidth = useMemo(() => gridWidthOf(columns, ROW_MARKER_WIDTH), [columns]);

  const rowHeightFor = useCallback((row) => rowHeights[row?.key] || defaultRowHeight, [defaultRowHeight, rowHeights]);

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
  const fillSourceRange = selectionRange(cellSelection);
  const fillHandleEnabled = Boolean(
    fillSourceRange
    && !editingCell
    && !picker
    && loadState !== "saving"
    && adapters.slice(fillSourceRange.left, fillSourceRange.right + 1).every((adapter) => adapter?.writable && adapter.kind !== "readonly")
    && rows.slice(fillSourceRange.top, fillSourceRange.bottom + 1).every((row) => row && row.state !== "deleted")
  );
  const fillResult = useMemo(() => {
    if (!fillDrag) return null;
    return buildFillChanges({
      sourceRange: fillDrag.sourceRange,
      targetRow: fillDrag.targetRow,
      rows,
      adapters,
      maxCells: MAX_CELLS,
      maxNewRows: MAX_NEW_ROWS
    });
  }, [adapters, fillDrag, rows]);
  const fillPreviewCells = useMemo(() => fillPreviewMap(fillResult?.previewValues), [fillResult]);
  const previewBottom = fillResult?.targetRange?.bottom ?? -1;
  const renderedRowCount = Math.max(rows.length, Math.min(rows.length + MAX_NEW_ROWS, previewBottom + 1));
  const renderRows = useMemo(() => {
    if (renderedRowCount <= rows.length) return rows;
    const previews = [];
    for (let rowIndex = rows.length; rowIndex < renderedRowCount; rowIndex += 1) {
      previews.push({
        key: `fill-preview-${rowIndex}`,
        rowId: null,
        serverSnapshot: {},
        values: Object.fromEntries(allControls.map((control) => [control.controlId, ""])),
        dirtyFields: [],
        cellErrors: {},
        state: "preview",
        saveError: ""
      });
    }
    return [...rows, ...previews];
  }, [allControls, renderedRowCount, rows]);
  const virtualWindow = useMemo(() => {
    return calculateVirtualWindow({ rowCount: renderRows.length, scrollTop: virtualScrollTop, viewportHeight: gridRef.current?.clientHeight || 600, rowHeight: defaultRowHeight, threshold: VIRTUALIZE_AFTER, buffer: VIRTUAL_BUFFER });
  }, [defaultRowHeight, renderRows.length, virtualScrollTop]);
  const visibleRenderRows = renderRows.slice(virtualWindow.start, virtualWindow.end);

  useEffect(() => {
    diagnostics.info("performance.renderWindow", { loadedRows: rows.length, logicalRows: renderRows.length, renderedRows: visibleRenderRows.length, memoryBytes: globalThis.performance?.memory?.usedJSHeapSize });
  }, [renderRows.length, rows.length, visibleRenderRows.length]);

  const loadInitial = useCallback(async (filters, options = {}) => {
    const startedAt = globalThis.performance?.now?.() || Date.now();
    const request = ++requestRef.current;
    filtersRef.current = filters || {};
    setLoadState("loading");
    setMessage("正在加载记录…");
    setPicker(null);
    setColumnMenu(null);
    try {
      const [records, count] = await Promise.all([
        gateway.loadPage({ pageIndex: 1, pageSize: PAGE_SIZE, filters: filtersRef.current }),
        gateway.loadTotal(filtersRef.current)
      ]);
      if (request !== requestRef.current) return;
      const currentRows = rowsRef.current;
      const serverRows = records.map((record) => createServerRow(record, allControls));
      const restored = hydratedRef.current ? { rows: [], incompatible: false, migrated: false } : loadDrafts(runtimeConfig, allControls);
      const nextRows = options.forceServer
        ? serverRows
        : hydratedRef.current
        ? mergeQueriedRows(currentRows, records, allControls)
        : mergeRestoredDrafts(serverRows, restored.rows, allControls);
      const conflictCount = nextRows.filter((row) => row.conflict).length;
      setRows(nextRows, { clearHistory: true });
      if (!hydratedRef.current) {
        layoutMigrationPendingRef.current = layoutNeedsMigration(runtimeConfig.view);
        const savedLayout = normalizeLayout(runtimeConfig.view, controls);
        setColumnWidths(savedLayout.columnWidths);
        setDefaultRowHeight(savedLayout.defaultRowHeight);
        setRowHeights(savedLayout.rowHeights);
        setLayoutReady(true);
      }
      setTotal(count ?? (records.length < PAGE_SIZE ? records.length : null));
      setHasMore(count == null ? records.length === PAGE_SIZE : records.length < count);
      loadedServerCountRef.current = records.length;
      pageRef.current = 1;
      setLoadState("ready");
      setHydrated(true);
      diagnostics.info("performance.initialLoad", { durationMs: Math.round((globalThis.performance?.now?.() || Date.now()) - startedAt), recordCount: records.length, withinBudget: (globalThis.performance?.now?.() || Date.now()) - startedAt <= 2000 });
      setRefreshPending(false);
      if (conflictCount) setMessage(`检测到 ${conflictCount} 条服务端记录已变化，本地草稿未被覆盖；请核对后再保存`);
      else if (restored.incompatible) setMessage("字段结构已变化，旧草稿未套用；放弃草稿后可清理");
      else if (restored.rows.length) setMessage(`已恢复 ${restored.rows.length} 条草稿${restored.migrated ? "（已升级）" : ""}`);
      else if (currentRows.some(hasPendingChange)) setMessage(`已刷新 ${records.length} 条记录，保留 ${currentRows.filter(hasPendingChange).length} 条本地草稿`);
      else if (columnConfig.source === "fallback-invalid") setMessage(`显示字段配置已失效，已回退为业务字段（${columnConfig.invalidIds.length} 个字段不可用）`);
      else setMessage(`已加载 ${records.length} 条记录`);
    } catch (error) {
      if (request !== requestRef.current) return;
      setLoadState("failed");
      diagnostics.error("load.initial", error, { durationMs: Math.round((globalThis.performance?.now?.() || Date.now()) - startedAt) });
      setMessage(`加载失败：${error?.message || "请检查视图权限或网络"}`);
    }
  }, [allControls, columnConfig.invalidIds.length, columnConfig.source, controls, gateway, runtimeConfig, setRows]);

  const composeQuery = useCallback((externalFilters = {}, nextQuery = queryRef.current) => mergeQueryParams(externalFilters, {
    sortId: nextQuery.sortId,
    isAsc: nextQuery.isAsc,
    filters: filterMapToList(nextQuery.filterMap, controls)
  }), [controls]);
  const reloadWithQuery = useCallback((externalFilters = externalFiltersRef.current, nextQuery = queryRef.current) => {
    externalFiltersRef.current = externalFilters || {};
    return loadInitial(composeQuery(externalFiltersRef.current, nextQuery));
  }, [composeQuery, loadInitial]);

  useEffect(() => {
    const handleOffline = () => { setOnline(false); setMessage("网络已断开，草稿已保留；恢复联网后再保存"); diagnostics.info("network.offline"); };
    const handleOnline = () => { setOnline(true); setMessage("网络已恢复，正在刷新并核对服务端数据…"); diagnostics.info("network.online"); reloadWithQuery(externalFiltersRef.current, queryRef.current); };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => { window.removeEventListener("offline", handleOffline); window.removeEventListener("online", handleOnline); };
  }, [reloadWithQuery]);

  useEffect(() => {
    const flush = () => { if (hydratedRef.current) saveDrafts(runtimeConfig, allControls, rowsRef.current); };
    const beforeUnload = (event) => {
      if (!rowsRef.current.some(hasPendingChange)) return;
      flush();
      event.preventDefault();
      event.returnValue = "";
    };
    const visibility = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("visibilitychange", visibility);
    return () => { flush(); window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("visibilitychange", visibility); };
  }, [allControls, runtimeConfig]);

  const loadNext = useCallback(async () => {
    if (!hasMore || loadingMoreRef.current || loadState !== "ready") return;
    loadingMoreRef.current = true;
    const nextPage = pageRef.current + 1;
    try {
      const records = await gateway.loadPage({ pageIndex: nextPage, pageSize: PAGE_SIZE, filters: filtersRef.current });
      const loadedIds = new Set(rows.filter((row) => row.rowId).map((row) => row.rowId));
      const overlapsLoadedRow = records.some((record) => loadedIds.has(rowIdOf(record)));
      setRows((current) => mergeServerPage(current, records, allControls), { clearHistory: overlapsLoadedRow });
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
  }, [allControls, gateway, hasMore, loadState, rows, total]);

  useEffect(() => { reloadWithQuery({}); }, [reloadWithQuery]);
  useEffect(() => gateway.on("filters-update", (filters) => {
    reloadWithQuery(filters || {}, queryRef.current);
  }), [gateway, reloadWithQuery]);
  useEffect(() => gateway.on("new-record", () => {
    if (rowsRef.current.some(hasPendingChange)) {
      setRefreshPending(true);
      setMessage("服务端新增了记录；当前草稿未覆盖，保存或放弃后可刷新");
    } else reloadWithQuery(externalFiltersRef.current, queryRef.current);
  }), [gateway, reloadWithQuery]);
  useEffect(() => gateway.on("update-record", () => {
    if (rowsRef.current.some(hasPendingChange)) {
      setRefreshPending(true);
      setMessage("服务端记录已更新；当前草稿未覆盖，保存或放弃后可刷新");
    } else reloadWithQuery(externalFiltersRef.current, queryRef.current);
  }), [gateway, reloadWithQuery]);
  useEffect(() => gateway.on("delete-record", () => {
    if (rowsRef.current.some(hasPendingChange)) {
      setRefreshPending(true);
      setMessage("服务端记录已删除；当前草稿未覆盖，保存或放弃后可刷新");
    } else reloadWithQuery(externalFiltersRef.current, queryRef.current);
  }), [gateway, reloadWithQuery]);
  useEffect(() => {
    if (!hydrated) return undefined;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveDrafts(runtimeConfig, allControls, rows), 300);
    return () => clearTimeout(saveTimer.current);
  }, [allControls, hydrated, rows, runtimeConfig]);

  useEffect(() => {
    if (!layoutReady) return undefined;
    const shouldMigrate = layoutMigrationPendingRef.current;
    const revision = layoutRevisionRef.current + 1;
    layoutRevisionRef.current = revision;
    if (!layoutSaveArmedRef.current) {
      layoutSaveArmedRef.current = true;
      if (!shouldMigrate) return undefined;
    }
    layoutDirtyRef.current = true;
    clearTimeout(layoutSaveTimer.current);
    setLayoutStatus(shouldMigrate ? "布局格式修复中" : "布局待保存");
    layoutSaveTimer.current = setTimeout(async () => {
      try {
        await gateway.saveViewLayout(runtimeConfig.view || {}, { columnWidths, defaultRowHeight, rowHeights });
        if (layoutRevisionRef.current === revision) {
          layoutDirtyRef.current = false;
          layoutMigrationPendingRef.current = false;
          setLayoutStatus("布局已保存");
        }
      } catch (error) {
        if (layoutRevisionRef.current === revision) {
          if (shouldMigrate) layoutMigrationPendingRef.current = true;
          setLayoutStatus("布局保存失败");
          setMessage(`布局保存失败：${error?.message || "请稍后重试"}`);
        }
      }
    }, 500);
    return () => clearTimeout(layoutSaveTimer.current);
  }, [columnWidths, defaultRowHeight, gateway, layoutReady, rowHeights, runtimeConfig.view]);

  useEffect(() => () => {
    clearTimeout(layoutSaveTimer.current);
    if (!layoutReady || !layoutSaveArmedRef.current || !layoutDirtyRef.current) return;
    gateway.saveViewLayout(runtimeConfig.view || {}, latestLayoutRef.current).catch(() => {});
  }, [gateway, layoutReady, runtimeConfig.view]);

  const applyQueryState = useCallback((nextQuery, statusMessage) => {
    queryRef.current = nextQuery;
    setQueryState(nextQuery);
    setCellSelection(null);
    setEditingCell(null);
    setPicker(null);
    reloadWithQuery(externalFiltersRef.current, nextQuery);
    if (statusMessage) setMessage(statusMessage);
  }, [reloadWithQuery]);

  const applySort = useCallback((sortId, isAsc) => {
    const next = { ...queryRef.current, sortId, isAsc: Boolean(isAsc) };
    applyQueryState(next, sortId ? `正在按${isAsc ? "升序" : "降序"}加载…` : "正在取消排序…");
    setColumnMenu(null);
  }, [applyQueryState]);

  const applyFilter = useCallback((fieldId, filter) => {
    const nextMap = { ...queryRef.current.filterMap };
    if (buildNativeFilter({ control: controls.find((control) => control.controlId === fieldId), operator: filter.operator, value: filter.value })) nextMap[fieldId] = filter;
    else delete nextMap[fieldId];
    applyQueryState({ ...queryRef.current, filterMap: nextMap }, "正在应用筛选…");
  }, [applyQueryState, controls]);

  const clearFilter = useCallback((fieldId) => {
    const nextMap = { ...queryRef.current.filterMap };
    delete nextMap[fieldId];
    applyQueryState({ ...queryRef.current, filterMap: nextMap }, "正在清除筛选…");
  }, [applyQueryState]);

  const openColumnMenu = useCallback((event, column) => {
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    setColumnMenu({
      fieldId: column.id,
      left: Math.max(8, Math.min(window.innerWidth - 292, bounds.left)),
      top: Math.min(window.innerHeight - 360, bounds.bottom + 4)
    });
  }, []);

  const applyChanges = useCallback((changes, label = "编辑单元格") => {
    setRows((current) => {
      const next = [...current];
      changes.forEach(({ rowIndex, columnIndex, input, directValue, parsedValue, parsedError }) => {
        while (next.length <= rowIndex && next.filter((row) => !row.rowId).length < MAX_NEW_ROWS) next.push(createDraftRow(allControls));
        const row = next[rowIndex];
        const adapter = adapters[columnIndex];
        if (!row || !adapter || row.state === "deleted") return;
        const parsed = parsedError !== undefined || parsedValue !== undefined
          ? { value: parsedValue, error: parsedError }
          : directValue !== undefined ? { value: directValue } : adapter.parseEditor(input);
        next[rowIndex] = editRow(row, adapter.control.controlId, parsed.value, parsed.error);
      });
      return next;
    }, { record: true, label });
  }, [adapters, allControls, setRows]);

  const beginFillDrag = useCallback((event) => {
    if (event.button !== 0 || !fillHandleEnabled || !fillSourceRange) return;
    event.preventDefault();
    event.stopPropagation();
    const sourceSelection = cellSelection;
    fillDragRef.current = {
      pointerId: event.pointerId,
      sourceRange: fillSourceRange,
      targetRow: fillSourceRange.bottom
    };
    setEditingCell(null);
    setFillDrag({
      sourceRange: fillSourceRange,
      targetRow: fillSourceRange.bottom
    });
    gridRef.current?.focus?.({ preventScroll: true });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (sourceSelection) setCellSelection(sourceSelection);
  }, [cellSelection, fillHandleEnabled, fillSourceRange]);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollRef.current.frame) cancelAnimationFrame(autoScrollRef.current.frame);
    autoScrollRef.current = { frame: 0, x: 0, y: 0, clientX: 0, clientY: 0 };
  }, []);

  const cancelFillDrag = useCallback(() => {
    if (!fillDragRef.current) return;
    stopAutoScroll();
    fillDragRef.current = null;
    setFillDrag(null);
    setMessage("已取消拖拽填充");
  }, [stopAutoScroll]);

  const finishFillDrag = useCallback(() => {
    const drag = fillDragRef.current;
    if (!drag) return;
    stopAutoScroll();
    fillDragRef.current = null;
    setFillDrag(null);
    const result = buildFillChanges({
      sourceRange: drag.sourceRange,
      targetRow: drag.targetRow,
      rows,
      adapters,
      maxCells: MAX_CELLS,
      maxNewRows: MAX_NEW_ROWS
    });
    if (result.fatal) {
      setMessage(result.fatal);
      return;
    }
    if (!result.changes.length) {
      setMessage(result.errors.length ? result.errors[0].error : "拖拽范围未超出源选区");
      return;
    }
    applyChanges(result.changes, "拖拽填充");
    setCellSelection({
      anchor: { column: result.targetRange.left, row: result.targetRange.top },
      focus: { column: result.targetRange.right, row: result.targetRange.bottom }
    });
    setMessage(result.errors.length
      ? `已填充 ${result.changes.length} 个单元格，跳过 ${result.errors.length} 个不可填充单元格`
      : `已填充 ${result.changes.length} 个单元格`);
  }, [adapters, applyChanges, rows, stopAutoScroll]);

  const fillToEnd = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!fillSourceRange || !rows.length) return;
    const result = buildFillChanges({
      sourceRange: fillSourceRange,
      targetRow: rows.length - 1,
      rows,
      adapters,
      maxCells: MAX_CELLS,
      maxNewRows: MAX_NEW_ROWS
    });
    if (result.fatal) { setMessage(result.fatal); return; }
    if (result.changes.length) applyChanges(result.changes, "双击填充柄");
    setMessage(`已自动向下填充 ${result.changes.length} 格`);
  }, [adapters, applyChanges, fillSourceRange, rows, setMessage]);

  const selectCell = useCallback((cell, extend = false) => {
    const startedAt = globalThis.performance?.now?.() || Date.now();
    setEditingCell(null);
    setCellSelection((current) => ({ anchor: extend && current?.anchor ? current.anchor : cell, focus: cell }));
    gridRef.current?.focus?.({ preventScroll: true });
    requestAnimationFrame(() => {
      const durationMs = Math.round((globalThis.performance?.now?.() || Date.now()) - startedAt);
      if (durationMs > 50) diagnostics.info("performance.selectCell", { durationMs, withinBudget: durationMs <= 100 });
    });
  }, []);

  const moveCellSelection = useCallback((column, row, extend = false) => {
    setCellSelection((current) => {
      const next = moveSelection(current, column, row, adapters.length, Math.max(1, rows.length), extend);
      setTimeout(() => {
        const selector = `[data-grid-row="${next.focus.row}"][data-grid-column="${next.focus.column}"]`;
        const target = document.querySelector(selector);
        if (target) target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        else if (gridRef.current) {
          gridRef.current.scrollTop = next.focus.row * defaultRowHeight;
          requestAnimationFrame(() => document.querySelector(selector)?.scrollIntoView?.({ block: "nearest", inline: "nearest" }));
        }
      }, 0);
      return next;
    });
    setEditingCell(null);
  }, [adapters.length, defaultRowHeight, rows.length]);

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

  const cutCells = useCallback((event) => {
    if (!cellSelection || editingCell) return;
    const payload = createClipboardPayload(cellSelection, rows, adapters);
    if (!payload) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", payload.plain);
    try { event.clipboardData.setData(GRID_CLIPBOARD_TYPE, payload.structured); } catch (_) { /* plain TSV still works */ }
    const result = buildClearChanges({ selection: cellSelection, rows, adapters });
    if (result.changes.length) applyChanges(result.changes, "剪切单元格");
    const parts = [`已剪切 ${result.changes.length} 格`];
    if (result.skipped) parts.push(`跳过 ${result.skipped} 格不可编辑单元格`);
    setMessage(parts.join("，"));
  }, [adapters, applyChanges, cellSelection, editingCell, rows]);

  const pasteCells = useCallback((event) => {
    if (!cellSelection || editingCell) return;
    event.preventDefault();
    const matrix = readClipboardMatrix(event.clipboardData.getData("text/plain"), event.clipboardData.getData(GRID_CLIPBOARD_TYPE));
    const result = buildPasteChanges({ matrix, selection: cellSelection, adapters, rows, rowCount: rows.length, maxCells: MAX_CELLS, maxNewRows: MAX_NEW_ROWS });
    if (result.fatal) { setMessage(result.fatal); return; }
    if (result.changes.length) applyChanges(result.changes, "批量粘贴");
    if (result.target) setCellSelection({ anchor: { column: result.target.left, row: result.target.top }, focus: { column: result.target.right, row: result.target.bottom } });
    const successCount = result.changes.length - result.errors.length;
    const parts = [];
    if (successCount) parts.push(`已粘贴 ${successCount} 格`);
    else if (result.skipped.length && !result.errors.length) parts.push("未修改数据");
    if (result.skipped.length) parts.push(`忽略 ${result.skipped.length} 个只读单元格`);
    if (result.errors.length) parts.push(`${result.errors.length} 格类型不匹配或格式错误`);
    setMessage(parts.join("，") || "没有可粘贴的单元格");
  }, [adapters, applyChanges, cellSelection, editingCell, rows]);

  const handleCellContextMenu = useCallback((event, cell) => {
    event.preventDefault();
    const inside = containsCell(cellSelection, cell.column, cell.row);
    const selection = inside && cellSelection ? cellSelection : { anchor: cell, focus: cell };
    if (!inside) setCellSelection(selection);
    setEditingCell(null);
    setContextMenu({ left: Math.min(window.innerWidth - 260, Math.max(8, event.clientX)), top: Math.min(window.innerHeight - 420, Math.max(8, event.clientY)), columnIndex: cell.column, rowIndex: cell.row, selection });
  }, [cellSelection]);

  const runContextAction = useCallback(async (action) => {
    const menu = contextMenu;
    if (!menu) return;
    const selection = menu.selection;
    const adapter = adapters[menu.columnIndex];
    const row = rows[menu.rowIndex];
    const confirmImpact = (label, count, skipped = 0, force = false) => {
      if (!force && count <= 50 && Math.ceil(count / Math.max(1, selectionRange(selection)?.width || 1)) <= 20) return true;
      return window.confirm(`${label}\n预计修改 ${count} 个单元格${skipped ? `，跳过 ${skipped} 个不可编辑单元格` : ""}。\n操作将先生成本地草稿，可通过撤销恢复。`);
    };
    const payload = createClipboardPayload(selection, rows, adapters);
    const writePlainClipboard = async () => {
      if (!payload) return false;
      try { await navigator.clipboard.writeText(payload.plain); return true; }
      catch (_) { setMessage("无法访问系统剪贴板，请使用 Ctrl/Cmd+C"); return false; }
    };
    if (action === "copy" || action === "cut") {
      const copied = await writePlainClipboard();
      if (!copied) return;
      if (action === "cut") {
        const cleared = buildClearChanges({ selection, rows, adapters });
        if (cleared.changes.length) applyChanges(cleared.changes, "剪切单元格");
        setMessage(`已剪切 ${cleared.changes.length} 格${cleared.skipped ? `，跳过 ${cleared.skipped} 格` : ""}`);
      } else setMessage("已复制选区");
      return;
    }
    if (action === "clear") {
      const result = buildClearChanges({ selection, rows, adapters });
      if (result.changes.length) applyChanges(result.changes, "批量清空单元格");
      setMessage(`已清空 ${result.changes.length} 格${result.skipped ? `，跳过 ${result.skipped} 格` : ""}`);
      return;
    }
    if (action === "undo") { undoRows(); return; }
    if (action === "redo") { redoRows(); return; }
    if (action === "paste" || action === "pasteSkipEmpty" || action === "pasteFillBlank") {
      try {
        const text = await navigator.clipboard.readText();
        const mode = action === "pasteSkipEmpty" ? "skipEmpty" : action === "pasteFillBlank" ? "fillBlank" : "overwrite";
        const matrix = readClipboardMatrix(text, "");
        const result = buildPasteChanges({ matrix, selection, adapters, rows, rowCount: rows.length, pasteMode: mode, maxCells: MAX_CELLS, maxNewRows: MAX_NEW_ROWS });
        if (result.fatal) { setMessage(result.fatal); return; }
        if (result.changes.length) applyChanges(result.changes, `选择性粘贴${mode === "overwrite" ? "" : mode === "skipEmpty" ? "（跳过空值）" : "（仅填空白）"}`);
        setMessage(`已粘贴 ${result.changes.length} 格${result.skipped.length ? `，跳过 ${result.skipped.length} 格` : ""}`);
      } catch (_) { setMessage("无法读取系统剪贴板，请使用 Ctrl/Cmd+V"); }
      return;
    }
    if (["fill", "series", "fillBlank"].includes(action)) {
      const range = selectionRange(selection);
      const result = buildFillChanges({ sourceRange: range, targetRow: rows.length - 1, rows, adapters, fillMode: action === "series" ? "series" : "copy", writeMode: action === "fillBlank" ? "fillBlank" : "overwrite", maxCells: MAX_CELLS, maxNewRows: MAX_NEW_ROWS });
      if (result.fatal) { setMessage(result.fatal); return; }
      if (!confirmImpact(action === "series" ? "确认执行序列填充？" : "确认执行批量填充？", result.changes.length, result.errors.length)) return;
      if (result.changes.length) applyChanges(result.changes, action === "series" ? "序列填充" : action === "fillBlank" ? "仅填充空白" : "复制式填充");
      setMessage(`已填充 ${result.changes.length} 格${result.errors.length ? `，跳过 ${result.errors.length} 格` : ""}`);
      return;
    }
    if (["set", "column", "condition"].includes(action)) {
      let rowIndexes;
      if (action === "column") rowIndexes = rows.map((item, index) => item?.rowId && item.state !== "deleted" ? index : -1).filter((index) => index >= 0);
      else if (action === "condition") rowIndexes = filteredRowIndexes(rows, queryState.filterMap, controls, adapters);
      else rowIndexes = targetRowsForColumn(selection, menu.columnIndex, rows, adapters).rowIndexes;
      if (!rowIndexes.length) { setMessage("没有符合条件的可编辑记录"); return; }
      if (!confirmImpact(action === "column" ? "确认整列批量赋值？" : action === "condition" ? "确认按当前筛选条件修改？" : "确认批量设置？", rowIndexes.length, 0, action !== "set")) return;
      if (["select", "multiSelect", "member", "department", "orgRole", "relation", "location"].includes(adapter?.kind)) {
        setCellSelection({ anchor: { column: menu.columnIndex, row: rowIndexes[0] ?? menu.rowIndex }, focus: { column: menu.columnIndex, row: rowIndexes[rowIndexes.length - 1] ?? menu.rowIndex } });
        setContextMenu(null);
        await activateCell([menu.columnIndex, rowIndexes[0] ?? menu.rowIndex], null, rowIndexes);
        return;
      }
      const input = window.prompt(`${adapter?.control?.controlName || "字段"}批量赋值`, "");
      if (input === null) return;
      const parsed = adapter?.parseEditor(input) || { error: "字段不可编辑" };
      const changes = rowIndexes.map((rowIndex) => ({ rowIndex, columnIndex: menu.columnIndex, parsedValue: parsed.value, parsedError: parsed.error }));
      if (changes.length) applyChanges(changes, action === "condition" ? "按条件批量修改" : action === "column" ? "整列批量赋值" : "批量设置字段");
      setMessage(`已生成 ${changes.length} 格本地草稿`);
      return;
    }
    if (action === "replace") {
      const find = window.prompt("查找内容", "");
      if (find === null) return;
      const replacement = window.prompt("替换为", "");
      if (replacement === null) return;
      const rowIndexes = targetRowsForColumn(selection, menu.columnIndex, rows, adapters).rowIndexes;
      const result = buildReplaceChanges({ rows, rowIndexes, columnIndex: menu.columnIndex, adapters, find, replacement });
      if (result.fatal) { setMessage(result.fatal); return; }
      if (!confirmImpact("确认执行批量替换？", result.changes.length, result.skipped)) return;
      if (result.changes.length) applyChanges(result.changes, "批量替换");
      setMessage(`已生成 ${result.changes.length} 格替换草稿${result.errors.length ? `，${result.errors.length} 格待修正` : ""}`);
    }
  }, [adapters, applyChanges, contextMenu, controls, queryState.filterMap, redoRows, rows, setMessage, undoRows, activateCell]);

  const openNativeEditor = useCallback(async (row, adapter) => {
    if (!row?.rowId) {
      setMessage(`${adapter.control.controlName || "此字段"}需先保存记录后再编辑`);
      return;
    }
    if (rowsRef.current.some(hasPendingChange)) {
      setRefreshPending(true);
      setMessage("请先保存或放弃本地草稿，再打开 HAP 原生记录窗口");
      return;
    }
    try {
      const result = await gateway.openCurrentRecord(row.rowId);
      if (result?.action === "delete") {
        setRows((current) => current.filter((item) => item.rowId !== row.rowId), { clearHistory: true });
        setMessage("记录已在 HAP 原生窗口中删除");
        return;
      }
      const detail = await gateway.loadRowDetail(row.rowId);
      setRows((current) => current.map((item) => item.rowId === row.rowId ? rebaseRowFromServer(item, detail, allControls) : item), { clearHistory: true });
      setMessage(`${adapter.control.controlName || "字段"}已从 HAP 刷新`);
    } catch (error) {
      setMessage(`无法打开 HAP 原生记录窗口：${error?.message || "记录不存在或没有权限"}`);
    }
  }, [allControls, gateway, setRows]);

  const activateCell = useCallback(async ([columnIndex, rowIndex], anchor, explicitRows = null) => {
    const row = rows[rowIndex];
    const adapter = adapters[columnIndex];
    if (!row || !adapter || (!adapter.writable && !adapter.nativeEditor) || row.state === "deleted") return;
    const fieldId = adapter.control.controlId;
    if (adapter.nativeEditor) {
      await openNativeEditor(row, adapter);
      return;
    }
    if (adapter.kind === "select" || adapter.kind === "multiSelect") {
      const bounds = anchor?.getBoundingClientRect?.();
      const targetRows = explicitRows || [rowIndex];
      const boundsRows = targetRows.length ? targetRows : [rowIndex];
      setPicker({ columnIndex, rowIndex, rowIndexes: boundsRows, left: Math.max(8, bounds?.x || 16), top: Math.max(8, Math.min(window.innerHeight - 300, (bounds?.y || 40) + (bounds?.height || 36))) });
      return;
    }
    if (!["member", "department", "orgRole", "relation", "location"].includes(adapter.kind)) return;
    try {
      const selected = adapter.kind === "member" ? await gateway.selectUsers(adapter.control)
        : adapter.kind === "department" ? await gateway.selectDepartments(adapter.control)
        : adapter.kind === "orgRole" ? await gateway.selectOrgRoles(adapter.control)
        : adapter.kind === "location" ? await gateway.selectLocation(adapter.control, adapter.locationValue(row.values[fieldId]))
        : await gateway.selectRelation(adapter.control);
      if (!selected || (Array.isArray(selected) && !selected.length)) return;
      if (adapter.kind === "location") {
        const targetRows = explicitRows || [rowIndex];
        applyChanges((targetRows.length ? targetRows : [rowIndex]).map((targetRow) => ({ rowIndex: targetRow, columnIndex, directValue: selected })), "批量设置定位");
        return;
      }
      const list = Array.isArray(selected) ? selected : [selected];
      const unique = Number(adapter.control.enumDefault) === 1 || Number(adapter.control.subType) === 1;
      const value = adapter.kind === "member"
        ? (unique ? list.slice(0, 1) : list).map((item) => ({ ...item, accountId: item.accountId || item.id || item }))
        : adapter.kind === "department"
        ? (unique ? list.slice(0, 1) : list).map((item) => ({ ...item, departmentId: item.departmentId || item.id || item }))
        : adapter.kind === "orgRole"
        ? (unique ? list.slice(0, 1) : list).map((item) => ({ ...item, organizeId: item.organizeId || item.id || item }))
        : (unique ? list.slice(0, 1) : list).map((item) => ({ ...item, sid: item.sid || item.rowid || item.id || item }));
      const targetRows = explicitRows || [rowIndex];
      applyChanges((targetRows.length ? targetRows : [rowIndex]).map((targetRow) => ({ rowIndex: targetRow, columnIndex, directValue: adapter.copyValue ? adapter.copyValue(value) : value })), `批量设置${adapter.control.controlName || "字段"}`);
    } catch (error) {
      setMessage(`选择失败：${error?.message || "操作已取消"}`);
    }
  }, [adapters, applyChanges, cellSelection, gateway, openNativeEditor, rows]);

  const beginEdit = useCallback((cell, anchor) => {
    const row = rows[cell.row];
    const adapter = adapters[cell.column];
    if (!row || !adapter || (!adapter.writable && !adapter.nativeEditor) || row.state === "deleted") return;
    if (["select", "multiSelect", "member", "department", "orgRole", "relation", "location"].includes(adapter.kind) || adapter.nativeEditor) {
      activateCell([cell.column, cell.row], anchor);
      return;
    }
    if (adapter.kind === "checkbox") {
      applyChanges([{ rowIndex: cell.row, columnIndex: cell.column, directValue: !Boolean(row.values[adapter.control.controlId]) }], "切换复选框");
      return;
    }
    setEditingCell(cell);
  }, [activateCell, adapters, applyChanges, rows]);

  const openRelationRecord = useCallback(async (adapter, relation) => {
    try {
      const result = await gateway.openRelationRecord(adapter.control, relation);
      if (result?.action !== "update" && result?.action !== "delete") return;
      if (rows.some(hasPendingChange)) {
        setRefreshPending(true);
        setMessage("关联记录已变化；当前草稿未覆盖，保存或放弃后可刷新");
        return;
      }
      await loadInitial(filtersRef.current);
      setMessage(result.action === "delete" ? "关联记录已删除，列表已刷新" : "关联记录已更新，列表已刷新");
    } catch (error) {
      setMessage(`无法打开关联记录：${error?.message || "记录不存在或没有查看权限"}`);
    }
  }, [gateway, loadInitial, rows]);

  const handleGridKeyDown = useCallback((event) => {
    if (fillDrag) {
      if (event.key === "Escape") { event.preventDefault(); cancelFillDrag(); }
      return;
    }
    if (editingCell || !cellSelection) return;
    const keyMoves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (keyMoves[event.key]) {
      event.preventDefault();
      moveCellSelection(keyMoves[event.key][0], keyMoves[event.key][1], event.shiftKey);
    } else if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      const cell = cellSelection.focus;
      beginEdit(cell, document.querySelector(`[data-grid-row="${cell.row}"][data-grid-column="${cell.column}"]`));
    } else if (event.key === "Delete" || event.key === "Backspace") {
      const result = buildClearChanges({ selection: cellSelection, rows, adapters });
      if (result.changes.length || result.skipped) {
        event.preventDefault();
        if (result.changes.length) applyChanges(result.changes, "批量清空单元格");
        const messageParts = result.changes.length ? [`已清空 ${result.changes.length} 格`] : ["没有可清空的单元格"];
        if (result.skipped) messageParts.push(`跳过 ${result.skipped} 格不可编辑单元格`);
        setMessage(messageParts.join("，"));
      }
    }
  }, [adapters, applyChanges, beginEdit, cancelFillDrag, cellSelection, editingCell, fillDrag, moveCellSelection, rows, setMessage]);

  const handleUndoKeyDown = useCallback((event) => {
    const key = String(event.key || "").toLowerCase();
    if (!(event.ctrlKey || event.metaKey) || event.isComposing) return;
    const redo = (key === "y" && !event.shiftKey) || (key === "z" && event.shiftKey);
    const undo = key === "z" && !event.shiftKey;
    if (!redo && !undo) return;
    if (loadState !== "ready" || picker || (redo ? !canRedo(rowHistory) : !canUndo(rowHistory))) return;
    const target = event.target;
    const tagName = target?.tagName?.toLowerCase();
    const textInput = tagName === "textarea" || target?.isContentEditable || (tagName === "input" && !["checkbox", "radio", "button", "submit", "reset"].includes(target.type));
    if (textInput) return;
    event.preventDefault();
    if (redo) redoRows();
    else undoRows();
  }, [loadState, picker, redoRows, rowHistory, undoRows]);

  const beginColumnResize = useCallback((event, fieldId) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const column = columns.find((item) => item.id === fieldId);
    if (!column) return;
    columnResizeRef.current = { fieldId, startX: event.clientX, startWidth: column.width };
    setResizing(`column:${fieldId}`);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [columns]);

  const beginRowResize = useCallback((event, row) => {
    if (event.button !== 0 || !row || row.state === "preview") return;
    event.preventDefault();
    event.stopPropagation();
    rowResizeRef.current = { rowKey: row.key, startY: event.clientY, startHeight: rowHeightFor(row) };
    setResizing(`row:${row.key}`);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [rowHeightFor]);

  const finishResize = useCallback(() => {
    columnResizeRef.current = null;
    rowResizeRef.current = null;
    setResizing(null);
  }, []);

  const handleGridPointerMove = useCallback((event) => {
    if (columnResizeRef.current) {
      const resize = columnResizeRef.current;
      const width = clampColumnWidth(resize.startWidth + event.clientX - resize.startX, resize.startWidth);
      setColumnWidths((current) => current[resize.fieldId] === width ? current : { ...current, [resize.fieldId]: width });
      return;
    }
    if (rowResizeRef.current) {
      const resize = rowResizeRef.current;
      const height = clampRowHeight(resize.startHeight + event.clientY - resize.startY, resize.startHeight);
      setRowHeights((current) => current[resize.rowKey] === height ? current : { ...current, [resize.rowKey]: height });
      return;
    }
    if (fillDragRef.current) {
      const targetRow = rowIndexAtPoint(event, gridRef.current);
      if (targetRow !== null && Number.isFinite(targetRow)) {
        fillDragRef.current.targetRow = targetRow;
        setFillDrag((current) => current && current.targetRow === targetRow ? current : current ? { ...current, targetRow } : current);
      }
    }
    if (!draggingRef.current && !fillDragRef.current) return;
    if (draggingRef.current) {
      const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest?.("td[data-grid-row]");
      if (cell) setCellSelection((current) => current ? { ...current, focus: { column: Number(cell.dataset.gridColumn), row: Number(cell.dataset.gridRow) } } : current);
    }
    const container = gridRef.current;
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    const velocity = scrollVelocity(event.clientX, event.clientY, bounds);
    autoScrollRef.current.x = velocity.x;
    autoScrollRef.current.y = velocity.y;
    autoScrollRef.current.clientX = event.clientX;
    autoScrollRef.current.clientY = event.clientY;
    if (!velocity.x && !velocity.y) { stopAutoScroll(); return; }
    if (autoScrollRef.current.frame) return;
    const tick = () => {
      const state = autoScrollRef.current;
      const target = gridRef.current;
      if (!target || (!draggingRef.current && !fillDragRef.current) || (!state.x && !state.y)) { stopAutoScroll(); return; }
      target.scrollLeft += state.x;
      target.scrollTop += state.y;
      if (fillDragRef.current) {
        const targetRow = rowIndexAtPoint({ clientX: state.clientX, clientY: state.clientY }, target);
        if (targetRow !== null && Number.isFinite(targetRow) && targetRow !== fillDragRef.current.targetRow) {
          fillDragRef.current.targetRow = targetRow;
          setFillDrag((current) => current ? { ...current, targetRow } : current);
        }
      }
      state.frame = requestAnimationFrame(tick);
    };
    autoScrollRef.current.frame = requestAnimationFrame(tick);
  }, [stopAutoScroll]);

  useEffect(() => {
    const stopDragging = () => { draggingRef.current = false; stopAutoScroll(); finishResize(); finishFillDrag(); };
    const cancelDragging = () => { draggingRef.current = false; stopAutoScroll(); finishResize(); cancelFillDrag(); };
    window.addEventListener("pointermove", handleGridPointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", cancelDragging);
    return () => {
      window.removeEventListener("pointermove", handleGridPointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", cancelDragging);
    };
  }, [cancelFillDrag, finishFillDrag, finishResize, handleGridPointerMove, stopAutoScroll]);

  function addRow() {
    const draft = createDraftRow(allControls);
    const rowIndex = rows.length;
    setRows((current) => [...current, draft], { record: true, label: "新增记录" });
    const firstWritable = Math.max(0, adapters.findIndex((adapter) => adapter.writable));
    setCellSelection({ anchor: { column: firstWritable, row: rowIndex }, focus: { column: firstWritable, row: rowIndex } });
    setTimeout(() => document.querySelector(`[data-row-key="${draft.key}"] [data-grid-column="${firstWritable}"]`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" }), 0);
    setMessage("已新增一条草稿行");
  }

  function toggleDeleteSelected() {
    const selectedKeys = new Set(selectedRows);
    const indices = rows.map((row, index) => selectedKeys.has(row.key) ? index : -1).filter((index) => index >= 0);
    if (!indices.length) { setMessage("请先勾选要删除的行"); return; }
    const allDeleted = indices.every((index) => rows[index].state === "deleted");
    setRows((current) => {
      if (allDeleted) return current.map((row, index) => indices.includes(index) ? restoreDeleted(row) : row);
      return current.flatMap((row, index) => {
        if (!indices.includes(index)) return [row];
        const deleted = markDeleted(row);
        return deleted ? [deleted] : [];
      });
    }, { record: true, label: allDeleted ? "撤销删除" : "标记删除" });
    setSelectedRows([]);
    setMessage(allDeleted ? "已撤销待删除标记" : "已标记待删除；保存后才会删除服务端记录");
  }

  async function save() {
    if (!hasDrafts || loadState === "saving" || commitLockRef.current) return;
    if (!online) { setMessage("当前离线，草稿未提交"); return; }
    const unknownRows = rows.filter((row) => row.state === "unknown");
    if (unknownRows.length && !window.confirm(`有 ${unknownRows.length} 条新增记录的上次提交结果未知。请先在 HAP 中核对；确认仍要重试吗？重复提交可能产生重复记录。`)) return;
    const preparedRows = normalizeOptionalFieldErrors(rows, allAdapters);
    const errors = validateRows(preparedRows, allAdapters);
    if (errors.size) {
      setRows((current) => current.map((row) => errors.has(row.key) ? { ...row, cellErrors: errors.get(row.key), state: "error", saveError: "请修正字段错误" } : row), { rebaseHistory: true });
      const hiddenFields = hiddenErrorFieldNames(errors, allControls, controls);
      setMessage(hiddenFields.length
        ? `有 ${errors.size} 行校验失败；隐藏字段“${hiddenFields.join("、")}”需在插件设置中重新显示后修正`
        : `有 ${errors.size} 行校验失败，请先修正红色单元格`);
      return;
    }
    const summary = [pending.added && `新增 ${pending.added}`, pending.modified && `修改 ${pending.modified}`, pending.deleted && `删除 ${pending.deleted}`].filter(Boolean).join("、");
    if (!window.confirm(`确认提交：${summary}？\n删除操作提交后不可由本表格撤销。`)) return;
    commitLockRef.current = true;
    const abortController = new AbortController();
    commitAbortRef.current = abortController;
    const batchId = globalThis.crypto?.randomUUID?.() || `commit-${Date.now()}`;
    activeCommitRef.current = batchId;
    const submittingRows = preparedRows.map((row) => hasPendingChange(row) ? { ...row, commitBatchId: batchId } : row);
    rowsRef.current = submittingRows;
    saveDrafts(runtimeConfig, allControls, submittingRows);
    setLoadState("saving");
    setMessage("正在保存草稿…");
    setSaveProgress({ completed: 0, total: pending.added + pending.modified + pending.deleted });
    try {
      const result = await commitRows(submittingRows, allAdapters, gateway, (progress) => {
        setSaveProgress(progress);
        setMessage(progress.phase === "delete" ? "正在删除记录…" : `正在保存 ${progress.completed}/${progress.total}…`);
      }, { signal: abortController.signal });
      let next = applyCommitResult(submittingRows, result);
      const refreshed = await Promise.all(result.writes.filter((entry) => entry.ok).map(async (entry) => {
        const committed = next.find((row) => row.key === entry.item.key);
        if (!committed?.rowId) return null;
        try { return { key: committed.key, record: await gateway.loadRowDetail(committed.rowId) }; }
        catch (_) { return null; }
      }));
      const refreshedByKey = new Map(refreshed.filter(Boolean).map((entry) => [entry.key, entry.record]));
      next = next.map((row) => refreshedByKey.has(row.key) ? rebaseRowFromServer(row, refreshedByKey.get(row.key), allControls) : row);
      const resultSummary = commitSummary(result);
      const resultText = saveSummaryText(resultSummary);
      diagnostics.info("commit.complete", { batchId, summary: resultSummary });
      setRowHeights((current) => migrateRowHeights(current, result));
      const failedWrites = result.writes.filter((entry) => !entry.ok).length;
      const failed = failedWrites + (result.deletion && !result.deletion.ok ? result.deletion.rowIds.length : 0);
      const remoteMutation = result.writes.some((entry) => entry.ok) || Boolean(result.deletion?.ok);
      rowsRef.current = next;
      setRows(next, remoteMutation ? { clearHistory: true } : { rebaseHistory: true });
      saveDrafts(runtimeConfig, allControls, next);
      if (!failed && !result.deleteSkipped) clearDrafts(runtimeConfig);
      if (result.cancelled) {
        setRows(next, { rebaseHistory: true });
        saveDrafts(runtimeConfig, allControls, next);
        setMessage(`保存已取消：${resultText}；未处理草稿已保留`);
        return;
      }
      setMessage(`${failed || result.deleteSkipped ? "部分保存完成" : "保存完成"}：${resultText}，正在复核服务端…`);
      await loadInitial(filtersRef.current);
      setMessage(`${failed || result.deleteSkipped ? "部分保存完成" : "保存成功"}：${resultText}`);
    } catch (error) {
      diagnostics.error("commit.pipeline", error, { batchId });
      setLoadState("ready");
      setMessage(`保存流程异常：${error?.message || "请查看诊断详情"}`);
    } finally {
      if (activeCommitRef.current === batchId) activeCommitRef.current = "";
      if (commitAbortRef.current === abortController) commitAbortRef.current = null;
      commitLockRef.current = false;
      setSaveProgress(null);
    }
  }

  function cancelSave() {
    if (loadState !== "saving") return;
    commitAbortRef.current?.abort();
    setMessage("正在取消保存，已发出的请求会继续完成…");
  }

  function discard() {
    if (hasDrafts && !window.confirm("确认放弃全部未保存的新增、修改和删除草稿？")) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    clearDrafts(runtimeConfig);
    setRefreshPending(false);
    loadInitial(filtersRef.current, { forceServer: true });
  }

  function manualRefresh() {
    if (hasDrafts) {
      setRefreshPending(true);
      setMessage("当前存在本地草稿；保存或放弃后才能应用服务端最新数据");
      return;
    }
    reloadWithQuery(externalFiltersRef.current, queryRef.current);
  }

  async function copyDiagnostics() {
    try { await navigator.clipboard.writeText(diagnostics.export()); setMessage("诊断信息已复制"); }
    catch (error) { diagnostics.error("diagnostics.copy", error); setMessage("复制失败，请下载诊断文件"); }
  }

  function downloadDiagnostics() {
    const url = URL.createObjectURL(new Blob([diagnostics.export()], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `hap-table-diagnostics-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const selectedAllDeleted = selectedRows.length > 0 && selectedRows.every((key) => rows.find((row) => row.key === key)?.state === "deleted");
  const pickerAdapter = picker ? adapters[picker.columnIndex] : null;
  const pickerRow = picker ? rows[picker.rowIndex] : null;
  const cellSelectionRange = selectionRange(cellSelection);
  const menuColumn = columnMenu ? columns.find((column) => column.id === columnMenu.fieldId) : null;
  const menuControl = columnMenu ? controls.find((control) => control.controlId === columnMenu.fieldId) : null;
  const menuAdapter = columnMenu ? adapters.find((adapter) => adapter.control.controlId === columnMenu.fieldId) : null;

  return <div className="table-app" onKeyDown={handleUndoKeyDown}>
    <header className="table-toolbar">
      <div className="toolbar-primary">
        <button type="button" className="add-button" onClick={addRow} disabled={loadState === "saving"}><span>＋</span> 新增记录</button>
        <button type="button" className="ghost-button" onClick={toggleDeleteSelected} disabled={!selectedRows.length || loadState === "saving"}>
          {selectedAllDeleted ? "撤销删除" : "删除所选"}
        </button>
      </div>
      <div className="toolbar-status" title={message}>
        {!online && <span className="network-offline">离线</span>}
        {hasDrafts && <span className="draft-count">新增 {pending.added} · 修改 {pending.modified} · 删除 {pending.deleted}{pending.errors ? ` · 错误 ${pending.errors}` : ""}</span>}
        <span className={loadState === "failed" ? "status-error" : ""}>{message}</span>
      </div>
      <div className="toolbar-actions">
        <button type="button" className="ghost-button" onClick={() => setDiagnosticsOpen((value) => !value)}>诊断{diagnosticEntries.some((entry) => entry.level === "error") ? " !" : ""}</button>
        <button type="button" className="ghost-button" onClick={manualRefresh} disabled={loadState === "saving"}>刷新</button>
        <button type="button" className="ghost-button" onClick={discard} disabled={!hasDrafts && !refreshPending}>放弃草稿</button>
        {loadState === "saving"
          ? <button type="button" className="ghost-button" onClick={cancelSave}>取消保存</button>
          : <button type="button" className="save-button" onClick={save} disabled={!hasDrafts || !online}>保存</button>}
      </div>
    </header>

    {diagnosticsOpen && <aside className="diagnostics-panel" aria-label="诊断信息">
      <div className="diagnostics-header"><strong>诊断信息（已脱敏）</strong><span>{diagnosticEntries.length} 条</span></div>
      <div className="diagnostics-actions">
        <button type="button" onClick={copyDiagnostics}>复制</button>
        <button type="button" onClick={downloadDiagnostics}>下载 JSON</button>
        <button type="button" onClick={() => diagnostics.clear()}>清空</button>
      </div>
      <ol>{diagnosticEntries.slice(-50).reverse().map((entry) => <li key={entry.id} className={`diagnostic-${entry.level}`}>
        <time>{entry.time}</time><strong>{entry.operation}</strong><code>{entry.error?.message || entry.message || entry.code || ""}</code>
      </li>)}</ol>
    </aside>}

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
            onKeyDown={handleGridKeyDown} onCopy={copyCells} onCut={cutCells} onPaste={pasteCells} onPointerMove={handleGridPointerMove}
            onScroll={(event) => {
              const el = event.currentTarget;
              setVirtualScrollTop(el.scrollTop);
              if (el.scrollTop + el.clientHeight >= el.scrollHeight - 500) loadNext();
            }}>
              <table className="native-grid" style={{ width: tableWidth, minWidth: "100%" }}>
                <colgroup>
                  <col className="row-marker" style={{ width: ROW_MARKER_WIDTH }} />
                  {columns.map((column) => <col key={column.id} style={{ width: column.width }} />)}
                </colgroup>
                <thead><tr>
                  <th className="row-marker" style={{ width: ROW_MARKER_WIDTH, minWidth: ROW_MARKER_WIDTH }}><input type="checkbox" aria-label="选择全部记录" checked={rows.length > 0 && selectedRows.length === rows.length} onChange={(event) => setSelectedRows(event.target.checked ? rows.map((row) => row.key) : [])} /></th>
                  {columns.map((column) => <th key={column.id} className={queryState.sortId === column.id || queryState.filterMap[column.id] ? "header-active" : ""} style={{ width: column.width, minWidth: 0 }}>
                    <span className="header-title">{column.title}</span>
                    {queryState.sortId === column.id && <span className="sort-indicator">{queryState.isAsc ? "↑" : "↓"}</span>}
                    {queryState.filterMap[column.id] && <span className="filter-indicator" title="已设置筛选">●</span>}
                    <button type="button" className="column-menu-trigger" aria-label={`打开${column.title}菜单`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => openColumnMenu(event, column)}>⌄</button>
                    <span className={`column-resize-handle ${resizing === `column:${column.id}` ? "active" : ""}`} aria-hidden="true" onPointerDown={(event) => beginColumnResize(event, column.id)} />
                  </th>)}
                </tr></thead>
                <tbody>
                {virtualWindow.top > 0 && <tr className="virtual-spacer" aria-hidden="true"><td colSpan={adapters.length + 1} style={{ height: virtualWindow.top }} /></tr>}
                {visibleRenderRows.map((row, visibleIndex) => {
                  const rowIndex = virtualWindow.start + visibleIndex;
                  const previewRow = row.state === "preview";
                  const rowHeight = rowHeightFor(row);
                  return <tr key={row.key} data-row-key={row.key} className={`row-${row.state}${row.conflict ? " row-conflict" : ""}`} style={{ height: rowHeight }} aria-hidden={previewRow || undefined}>
                  <td className="row-marker" style={{ height: rowHeight }}>{!previewRow && <input type="checkbox" aria-label={`选择第 ${rowIndex + 1} 行`} checked={selectedRows.includes(row.key)} onChange={(event) => setSelectedRows((current) => event.target.checked ? [...new Set([...current, row.key])] : current.filter((item) => item !== row.key))} />}<span>{rowIndex + 1}</span>{!previewRow && <span className={`row-resize-handle ${resizing === `row:${row.key}` ? "active" : ""}`} aria-label="调整行高" title="拖拽调整行高" onPointerDown={(event) => beginRowResize(event, row)} />}</td>
                  {adapters.map((adapter, columnIndex) => {
                    const fieldId = adapter.control.controlId;
                    const previewValue = fillPreviewCells.get(`${rowIndex}:${columnIndex}`);
                    const raw = previewValue ? previewValue.value : row.values[fieldId];
                    const disabled = !adapter.writable || row.state === "deleted";
                    const interactive = (adapter.writable || adapter.nativeEditor) && row.state !== "deleted";
                    const error = previewValue ? "" : row.cellErrors[fieldId];
                    const cell = { column: columnIndex, row: rowIndex };
                    const active = sameCell(cellSelection?.focus, cell);
                    const selected = containsCell(cellSelection, columnIndex, rowIndex);
                    const selectionEdges = selected && cellSelectionRange ? [
                      cellSelectionRange.top === rowIndex && "cell-selection-top",
                      cellSelectionRange.bottom === rowIndex && "cell-selection-bottom",
                      cellSelectionRange.left === columnIndex && "cell-selection-left",
                      cellSelectionRange.right === columnIndex && "cell-selection-right"
                    ].filter(Boolean) : [];
                    const editing = sameCell(editingCell, cell);
                    const display = adapter.kind === "checkbox" ? (raw ? "✓" : "") : adapter.display(raw);
                    const number = adapter.numberPresentation(raw);
                    const optionTags = ["select", "multiSelect"].includes(adapter.kind) ? adapter.optionTags(raw) : [];
                    const memberTags = adapter.kind === "member" ? adapter.memberTags(raw) : [];
                    const entityTags = ["department", "appRole", "orgRole"].includes(adapter.kind) ? adapter.entityTags(raw) : [];
                    const attachmentItems = adapter.kind === "attachment" ? adapter.attachments(raw) : [];
                    const location = adapter.kind === "location" ? adapter.locationValue(raw) : null;
                    const relationItems = adapter.relationLinks(raw);
                    const showFillHandle = fillHandleEnabled
                      && !fillDrag
                      && !previewRow
                      && cellSelectionRange?.right === columnIndex
                      && cellSelectionRange?.bottom === rowIndex;
                    return <td
                      key={fieldId}
                      style={{ height: rowHeight }}
                      data-grid-row={rowIndex}
                      data-grid-column={columnIndex}
                      role="gridcell"
                      aria-selected={selected}
                      aria-readonly={disabled}
                      className={[error && "cell-error", selected && "cell-selected", previewValue && "cell-fill-preview", ...selectionEdges, active && "cell-active", editing && "cell-editing", disabled && "cell-disabled", number && "cell-number", adapter.nativeEditor && "cell-native-editor"].filter(Boolean).join(" ")}
                      title={error || (previewValue ? `预览：${display}` : display)}
                      onPointerDown={(event) => {
                        if (previewRow || event.button !== 0 || editing) return;
                        event.preventDefault();
                        draggingRef.current = true;
                        selectCell(cell, event.shiftKey);
                      }}
                      onContextMenu={(event) => handleCellContextMenu(event, cell)}
                      onDoubleClick={(event) => { event.preventDefault(); if (interactive) beginEdit(cell, event.currentTarget); }}
                    >
                      {editing
                        ? <CellInputEditor
                            adapter={adapter}
                            raw={raw}
                            onCommit={(input) => { applyChanges([{ rowIndex, columnIndex, input }], "编辑单元格"); setEditingCell(null); }}
                            onCancel={() => setEditingCell(null)}
                            onMove={(movement) => {
                              setCellSelection((current) => moveSelection(current, movement.column, movement.row, adapters.length, Math.max(1, rows.length), false));
                              setEditingCell(null);
                            }}
                          />
                        : <div className={`cell-display kind-${adapter.kind}`}>
                            {number?.formattedValue
                              ? <NumberDisplay presentation={number} />
                              : optionTags.length
                              ? <OptionTags tags={optionTags} />
                              : memberTags.length
                              ? <MemberTags tags={memberTags} />
                              : entityTags.length
                              ? <EntityTags items={entityTags} kind={adapter.kind} />
                              : attachmentItems.length
                              ? <AttachmentDisplay items={attachmentItems} onPreview={(item) => {
                                  if (!item.url) { setMessage("附件缺少可预览地址，请在 HAP 原生记录窗口中查看"); return; }
                                  window.open(item.url, "_blank", "noopener,noreferrer");
                                }} />
                              : location
                              ? <LocationDisplay value={location} />
                              : adapter.kind === "relation" && relationItems.length
                              ? <RelationDisplay
                                  links={relationItems}
                                  fallback={display}
                                  canOpen={!previewRow && row.state !== "deleted"}
                                  onOpen={(relation) => openRelationRecord(adapter, relation)}
                                />
                              : display ? <span className="cell-text">{display}</span> : (adapter.nativeEditor
                                ? <span className="cell-placeholder">{row.rowId ? "双击在 HAP 中编辑" : "先保存记录后编辑"}</span>
                                : (!disabled && ["select", "multiSelect", "member", "department", "orgRole", "relation", "location"].includes(adapter.kind) ? <span className="cell-placeholder">请选择</span> : ""))}
                          </div>}
                      {error && <small>{error}</small>}
                      {showFillHandle && <button
                        type="button"
                        className="fill-handle"
                        aria-label="拖拽填充"
                        title="拖拽填充"
                        tabIndex={-1}
                        onPointerDown={beginFillDrag}
                        onDoubleClick={fillToEnd}
                      />}
                    </td>;
                  })}
                </tr>;
                })}
                {virtualWindow.bottom > 0 && <tr className="virtual-spacer" aria-hidden="true"><td colSpan={adapters.length + 1} style={{ height: virtualWindow.bottom }} /></tr>}
                </tbody>
              </table>
              <button type="button" className="append-row" onClick={addRow}>＋ 新增记录</button>
            </div>}
      {loadState === "loading" && <div className="loading-overlay"><span className="spinner" />正在加载表格…</div>}
    </main>

    <footer className="table-footer">
      <span>{total == null ? `已加载 ${loadedCount} 条` : `已加载 ${loadedCount} / 共 ${total} 条`}{hasMore ? " · 向下滚动继续加载" : " · 已全部加载"}{layoutStatus ? ` · ${layoutStatus}` : ""}</span>
      <span>拖拽或 Shift 扩展选区 · 右下角填充柄上下拖拽复制 · Ctrl/Cmd+C/V 批量复制粘贴 · Ctrl/Cmd+Z 撤销 · Enter/F2 编辑</span>
    </footer>

    {columnMenu && menuColumn && menuControl && menuAdapter && <ColumnMenu
      column={menuColumn}
      control={menuControl}
      adapter={menuAdapter}
      position={columnMenu}
      queryFilter={queryState.filterMap[menuControl.controlId]}
      sortId={queryState.sortId}
      isAsc={queryState.isAsc}
      onSort={applySort}
      onFilter={applyFilter}
      onClearFilter={clearFilter}
      onClose={() => setColumnMenu(null)}
    />}

    {contextMenu && <ContextMenu
      position={contextMenu}
      onAction={runContextAction}
      onClose={() => setContextMenu(null)}
    />}

    {picker && pickerAdapter && pickerRow && <ChoicePopover
      picker={picker}
      adapter={pickerAdapter}
      value={pickerRow.values[pickerAdapter.control.controlId]}
      onApply={(value) => applyChanges((picker.rowIndexes || [picker.rowIndex]).map((rowIndex) => ({ rowIndex, columnIndex: picker.columnIndex, directValue: pickerAdapter.copyValue ? pickerAdapter.copyValue(value) : value })), pickerAdapter.kind === "multiSelect" || pickerAdapter.kind === "select" ? "批量选择选项" : "批量编辑字段")}
      onClose={() => setPicker(null)}
    />}
  </div>;
}
