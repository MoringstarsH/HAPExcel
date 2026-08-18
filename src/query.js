const TEXT_FILTERS = [
  { key: "contains", label: "包含", filterType: 1, valueMode: "text" },
  { key: "equals", label: "是", filterType: 2, valueMode: "text" },
  { key: "notContains", label: "不包含", filterType: 3, valueMode: "text" },
  { key: "notEquals", label: "不是", filterType: 4, valueMode: "text" },
  { key: "startsWith", label: "开头为", filterType: 5, valueMode: "text" },
  { key: "endsWith", label: "结尾为", filterType: 6, valueMode: "text" },
  { key: "empty", label: "为空", filterType: 7, valueMode: "none" },
  { key: "notEmpty", label: "不为空", filterType: 8, valueMode: "none" }
];

const NUMBER_FILTERS = [
  { key: "equals", label: "等于", filterType: 10, valueMode: "number" },
  { key: "notEquals", label: "不等于", filterType: 12, valueMode: "number" },
  { key: "greaterThan", label: "大于", filterType: 13, valueMode: "number" },
  { key: "lessThan", label: "小于", filterType: 14, valueMode: "number" },
  { key: "greaterOrEqual", label: "大于等于", filterType: 15, valueMode: "number" },
  { key: "lessOrEqual", label: "小于等于", filterType: 16, valueMode: "number" },
  { key: "between", label: "在范围内", filterType: 11, valueMode: "range" },
  { key: "empty", label: "为空", filterType: 7, valueMode: "none" },
  { key: "notEmpty", label: "不为空", filterType: 8, valueMode: "none" }
];

const DATE_FILTERS = [
  { key: "equals", label: "是", filterType: 17, valueMode: "date" },
  { key: "between", label: "在范围内", filterType: 31, valueMode: "range" },
  { key: "before", label: "早于", filterType: 32, valueMode: "date" },
  { key: "after", label: "晚于", filterType: 33, valueMode: "date" },
  { key: "empty", label: "为空", filterType: 7, valueMode: "none" },
  { key: "notEmpty", label: "不为空", filterType: 8, valueMode: "none" }
];

const CHOICE_FILTERS = [
  { key: "equals", label: "是其中一个", filterType: 2, valueMode: "choices" },
  { key: "notEquals", label: "不是任何一个", filterType: 3, valueMode: "choices" },
  { key: "empty", label: "为空", filterType: 7, valueMode: "none" },
  { key: "notEmpty", label: "不为空", filterType: 8, valueMode: "none" }
];

const RELATION_FILTERS = [
  { key: "equals", label: "是其中一个", filterType: 24, valueMode: "relation" },
  { key: "notEquals", label: "不是任何一个", filterType: 25, valueMode: "relation" },
  { key: "empty", label: "为空", filterType: 7, valueMode: "none" },
  { key: "notEmpty", label: "不为空", filterType: 8, valueMode: "none" }
];

function typeOf(control = {}) {
  const type = Number(control.type);
  if ([6, 8, 28, 31, 37, 38].includes(type)) return "number";
  if ([15, 16, 38, 46].includes(type)) return "date";
  if ([9, 10, 11].includes(type)) return "choice";
  if ([26, 27, 44, 48].includes(type)) return "member";
  if (type === 29) return "relation";
  if (type === 36) return "checkbox";
  return "text";
}

export function filterOptionsForControl(control = {}) {
  const kind = typeOf(control);
  if (kind === "number") return NUMBER_FILTERS;
  if (kind === "date") return DATE_FILTERS;
  if (kind === "choice") return CHOICE_FILTERS;
  if (kind === "relation" || kind === "member") return RELATION_FILTERS;
  if (kind === "checkbox") return [
    { key: "equals", label: "是", filterType: 2, valueMode: "boolean" },
    { key: "notEquals", label: "不是", filterType: 3, valueMode: "boolean" }
  ];
  return TEXT_FILTERS;
}

export function defaultFilterForControl(control = {}) {
  return filterOptionsForControl(control)[0] || TEXT_FILTERS[0];
}

function valuesOf(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== "" && item !== null && item !== undefined);
  if (value === "" || value === null || value === undefined) return [];
  return [value];
}

function normalizeFilterValue(value, mode) {
  if (mode === "none") return {};
  if (mode === "range") {
    const values = Array.isArray(value) ? value : ["", ""];
    return { minValue: values[0] || "", maxValue: values[1] || "" };
  }
  if (mode === "choices" || mode === "relation") {
    const values = typeof value === "string" ? value.split(/[,，、]/).map((item) => item.trim()).filter(Boolean) : valuesOf(value);
    return { values };
  }
  if (mode === "boolean") return { value: value ? 1 : 0 };
  if (mode === "number") return { value: value === "" ? "" : String(value) };
  return { values: valuesOf(value).map(String) };
}

export function buildNativeFilter({ control, operator, value } = {}) {
  if (!control?.controlId) return null;
  const option = filterOptionsForControl(control).find((item) => item.key === operator)
    || defaultFilterForControl(control);
  const normalized = normalizeFilterValue(value, option.valueMode);
  if (option.valueMode === "range" && !normalized.minValue && !normalized.maxValue) return null;
  if (option.valueMode !== "none" && option.valueMode !== "range" && !valuesOf(value).length) return null;
  return {
    controlId: control.controlId,
    dataType: Number(control.type),
    spliceType: 1,
    filterType: option.filterType,
    dateRange: option.valueMode === "date" ? 18 : undefined,
    dateRangeType: option.valueMode === "date" || option.valueMode === "number" ? 1 : undefined,
    ...normalized
  };
}

function filterListOf(params = {}) {
  if (Array.isArray(params.filters)) return { key: "filters", values: params.filters };
  if (Array.isArray(params.filterControls)) return { key: "filterControls", values: params.filterControls };
  return { key: "filters", values: [] };
}

export function mergeQueryParams(base = {}, { sortId = "", isAsc, filters = [] } = {}) {
  const next = { ...(base || {}) };
  const current = filterListOf(next);
  const combined = [...current.values, ...filters.filter(Boolean)];
  if (combined.length) next[current.key] = combined;
  else delete next[current.key];
  if (sortId) {
    next.sortId = sortId;
    next.isAsc = Boolean(isAsc);
  } else {
    delete next.sortId;
    delete next.isAsc;
  }
  return next;
}

export function filterMapToList(filterMap = {}, controls = []) {
  const controlsById = new Map(controls.map((control) => [control.controlId, control]));
  return Object.entries(filterMap).map(([fieldId, item]) => {
    const control = controlsById.get(fieldId);
    return buildNativeFilter({ control, operator: item?.operator, value: item?.value });
  }).filter(Boolean);
}

export function queryLabel({ sortId = "", isAsc, filterMap = {}, controls = [] } = {}) {
  const sort = sortId ? `${controls.find((control) => control.controlId === sortId)?.controlName || "字段"}${isAsc ? "升序" : "降序"}` : "未排序";
  const filters = Object.keys(filterMap).length;
  return filters ? `${sort} · ${filters} 个筛选` : sort;
}
