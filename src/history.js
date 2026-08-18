export const DEFAULT_HISTORY_LIMIT = 100;

function keyOf(row) {
  return row?.key || null;
}

function indexByKey(rows) {
  const result = new Map();
  rows.forEach((row, index) => {
    const key = keyOf(row);
    if (key) result.set(key, { row, index });
  });
  return result;
}

export function diffRows(beforeRows = [], afterRows = []) {
  const before = indexByKey(beforeRows);
  const after = indexByKey(afterRows);
  const keys = new Set([...before.keys(), ...after.keys()]);
  const changes = [];

  keys.forEach((key) => {
    const previous = before.get(key);
    const next = after.get(key);
    if (previous?.row === next?.row) return;
    changes.push({
      key,
      before: previous?.row || null,
      after: next?.row || null,
      beforeIndex: previous?.index ?? -1,
      afterIndex: next?.index ?? -1
    });
  });
  return changes;
}

function findRowIndex(rows, key) {
  return rows.findIndex((row) => keyOf(row) === key);
}

function expectedMatches(current, expected) {
  return expected ? current === expected : !current;
}

export function applyRowChanges(rows, changes, direction = "before") {
  const next = [...rows];
  const targetProperty = direction === "after" ? "after" : "before";
  const expectedProperty = direction === "after" ? "before" : "after";
  const indexProperty = direction === "after" ? "afterIndex" : "beforeIndex";

  for (const change of changes) {
    const currentIndex = findRowIndex(next, change.key);
    const current = currentIndex >= 0 ? next[currentIndex] : null;
    if (!expectedMatches(current, change[expectedProperty])) return { rows, conflict: true };

    const target = change[targetProperty];
    if (!target) {
      if (currentIndex >= 0) next.splice(currentIndex, 1);
      continue;
    }
    if (currentIndex >= 0) {
      next[currentIndex] = target;
      continue;
    }

    const requestedIndex = change[indexProperty];
    const insertionIndex = Math.max(0, Math.min(next.length, requestedIndex < 0 ? next.length : requestedIndex));
    next.splice(insertionIndex, 0, target);
  }
  return { rows: next, conflict: false };
}

function rebaseStack(stack, previousRows, nextRows) {
  const previous = indexByKey(previousRows);
  const next = indexByKey(nextRows);
  return stack.map((entry) => ({
    ...entry,
    changes: entry.changes.map((change) => {
      const previousCurrent = previous.get(change.key)?.row;
      const nextCurrent = next.get(change.key)?.row;
      if (previousCurrent && nextCurrent && change.after === previousCurrent) {
        return { ...change, after: nextCurrent };
      }
      return change;
    })
  }));
}

export function createHistoryState(value = [], limit = DEFAULT_HISTORY_LIMIT) {
  return {
    value,
    stack: [],
    redoStack: [],
    limit: Math.max(1, Number(limit) || DEFAULT_HISTORY_LIMIT),
    lastUndoLabel: "",
    lastRedoLabel: "",
    conflict: false
  };
}

export function historyReducer(state, action) {
  if (!state) return createHistoryState();

  if (action?.type === "apply") {
    const next = typeof action.update === "function" ? action.update(state.value) : action.value;
    const changes = diffRows(state.value, next || []);
    if (!changes.length) return { ...state, value: next || [], lastUndoLabel: "", conflict: false };
    const entry = { label: action.label || "操作", changes };
    return {
      ...state,
      value: next || [],
      stack: [...state.stack, entry].slice(-state.limit),
      redoStack: [],
      lastUndoLabel: "",
      lastRedoLabel: "",
      conflict: false
    };
  }

  if (action?.type === "replace") {
    const next = typeof action.update === "function" ? action.update(state.value) : action.value;
    const value = next || [];
    const stack = action.clearHistory
      ? []
      : action.rebaseHistory
        ? rebaseStack(state.stack, state.value, value)
        : state.stack;
    return { ...state, value, stack, redoStack: [], lastUndoLabel: "", lastRedoLabel: "", conflict: false };
  }

  if (action?.type === "clear") {
    return { ...state, stack: [], redoStack: [], lastUndoLabel: "", lastRedoLabel: "", conflict: false };
  }

  if (action?.type === "undo") {
    const entry = state.stack[state.stack.length - 1];
    if (!entry) return { ...state, lastUndoLabel: "", conflict: false };
    const result = applyRowChanges(state.value, entry.changes, "before");
    if (result.conflict) return { ...state, stack: [], lastUndoLabel: "", conflict: true };
    return {
      ...state,
      value: result.rows,
      stack: state.stack.slice(0, -1),
      redoStack: [...state.redoStack, entry].slice(-state.limit),
      lastUndoLabel: entry.label,
      lastRedoLabel: "",
      conflict: false
    };
  }

  if (action?.type === "redo") {
    const entry = state.redoStack[state.redoStack.length - 1];
    if (!entry) return { ...state, lastRedoLabel: "", conflict: false };
    const result = applyRowChanges(state.value, entry.changes, "after");
    if (result.conflict) return { ...state, redoStack: [], lastRedoLabel: "", conflict: true };
    return {
      ...state,
      value: result.rows,
      stack: [...state.stack, entry].slice(-state.limit),
      redoStack: state.redoStack.slice(0, -1),
      lastUndoLabel: "",
      lastRedoLabel: entry.label,
      conflict: false
    };
  }

  return state;
}

export function canUndo(state) {
  return Boolean(state?.stack?.length);
}

export function canRedo(state) {
  return Boolean(state?.redoStack?.length);
}

export function undoDepth(state) {
  return state?.stack?.length || 0;
}
