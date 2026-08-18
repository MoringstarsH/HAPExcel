const READ_ONLY_TYPES = new Set([14, 19, 21, 22, 23, 24, 25, 27, 28, 30, 31, 32, 33, 34, 35, 37, 38, 39, 40, 41, 42, 43, 44, 45, 47, 48]);

export function safeJson(value, fallback = value) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

export function isWritableControl(control = {}) {
  return !control.readonly && !control.disabled && !READ_ONLY_TYPES.has(Number(control.type));
}

export function getFieldKind(control = {}, rawValue) {
  const type = Number(control.type);
  if (type === 9 || type === 11) return "select";
  if (type === 10) return "multiSelect";
  if (type === 26) return "member";
  if (type === 29) return "relation";
  if (type === 36) return "checkbox";
  if (type === 15) return "date";
  if (type === 16) return "datetime";
  if (type === 46) return "time";
  if (type === 6 || type === 8) return "number";
  if ([2, 3, 4, 5, 7].includes(type)) return "text";
  if (typeof rawValue === "boolean") return "checkbox";
  if (typeof rawValue === "number") return "number";
  return "readonly";
}

function optionsOf(control) { return Array.isArray(control.options) ? control.options : []; }

function optionByText(control, text) {
  const normalized = String(text ?? "").trim();
  const matches = optionsOf(control).filter((option) => String(option.value ?? option.name ?? "").trim() === normalized);
  if (matches.length > 1) return { error: "存在同名选项，请打开选项菜单选择" };
  if (!matches.length && normalized) return { error: `未找到选项“${normalized}”` };
  return matches[0] || null;
}

function keysFrom(raw) {
  const value = safeJson(raw, raw);
  if (Array.isArray(value)) return value.map((item) => typeof item === "object" ? item.key || item.id : item).filter(Boolean);
  return value ? [value] : [];
}

export function relationItems(raw) {
  if (typeof raw === "number" || (typeof raw === "string" && /^\d+$/.test(raw))) return [];
  const rows = safeJson(raw, raw);
  return Array.isArray(rows) ? rows : [];
}

export function relationLinks(raw) {
  return relationItems(raw).map((item) => {
    const value = item && typeof item === "object" ? item : { name: item };
    const sourceValue = safeJson(value.sourcevalue, {});
    const source = sourceValue && typeof sourceValue === "object" ? sourceValue : {};
    const recordId = value.sid || value.rowid || value.id || source.rowid || source.rowId || source.id || "";
    const label = value.fullname || value.name || value.title || value.label || (recordId ? "正在获取标题…" : "标题获取失败");
    return { label: String(label), recordId: String(recordId || ""), raw: item };
  }).filter((item) => item.label);
}

function itemLabels(items, keys) {
  return items.map((item) => item.fullname || item.name || item.title || item.label || item[keys[0]] || item[keys[1]] || item).filter(Boolean).map(String);
}

export function displayValue(control, raw) {
  if (raw === undefined || raw === null || raw === "") return "";
  const kind = getFieldKind(control, raw);
  if (kind === "checkbox") return raw === true || raw === 1 || raw === "1" || raw === "true" || raw === "是" || raw === "✓" ? "✓" : "";
  if (kind === "select" || kind === "multiSelect") {
    return keysFrom(raw).map((key) => optionsOf(control).find((item) => item.key === key)?.value ?? key).join(", ");
  }
  if (kind === "relation") {
    if (typeof raw === "number" || (typeof raw === "string" && /^\d+$/.test(raw))) return `已关联 ${raw} 条`;
    return itemLabels(relationItems(raw), ["sid", "rowid"]).join(", ");
  }
  if (kind === "member") {
    const members = safeJson(raw, raw);
    return Array.isArray(members) ? itemLabels(members, ["accountId", "id"]).join(", ") : String(raw);
  }
  if (kind === "number") {
    const number = Number(raw);
    if (!Number.isFinite(number)) return String(raw);
    return Number(control.type) === 8
      ? number.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: Number(control.dot ?? 2) })
      : number.toLocaleString("zh-CN", { maximumFractionDigits: Number(control.dot ?? 8) });
  }
  return String(raw);
}

export function valueLabels(control, raw) {
  const kind = getFieldKind(control, raw);
  if (kind === "select" || kind === "multiSelect") return displayValue(control, raw).split(/,\s*/).filter(Boolean);
  if (kind === "member") {
    const members = safeJson(raw, raw);
    return Array.isArray(members) ? itemLabels(members, ["accountId", "id"]) : [];
  }
  if (kind === "relation") {
    const items = relationItems(raw);
    return items.length ? itemLabels(items, ["sid", "rowid"]) : displayValue(control, raw) ? [displayValue(control, raw)] : [];
  }
  return [];
}

function parseInput(input, control) {
  const kind = getFieldKind(control);
  const text = String(input ?? "").trim();
  if (!isWritableControl(control) || kind === "readonly") return { error: "此字段为只读字段" };
  if (!text) return { value: kind === "checkbox" ? false : "" };
  if (kind === "number") return /^-?(?:\d+\.?\d*|\.\d+)$/.test(text.replace(/,/g, "")) ? { value: Number(text.replace(/,/g, "")) } : { error: "请输入有效数字" };
  if (kind === "checkbox") {
    const normalized = text.toLowerCase();
    if (["1", "是", "true", "✓", "√", "yes"].includes(normalized)) return { value: true };
    if (["0", "否", "false", "no"].includes(normalized)) return { value: false };
    return { error: "复选框只接受 1/0、是/否、true/false 或勾选符号" };
  }
  if (kind === "date" || kind === "datetime") {
    const normalized = text.replace(/年|\//g, "-").replace(/月/g, "-").replace(/日/g, "");
    const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!match) return { error: kind === "date" ? "请输入日期，如 2026-08-17" : "请输入日期时间，如 2026-08-17 14:30" };
    const [year, month, day] = match.slice(1, 4).map(Number);
    const date = new Date(year, month - 1, day);
    const validDate = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
    const validTime = match[4] === undefined || (Number(match[4]) < 24 && Number(match[5]) < 60 && (!match[6] || Number(match[6]) < 60));
    return validDate && validTime ? { value: normalized } : { error: "日期或时间无效" };
  }
  if (kind === "time") return /^([01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(text) ? { value: text } : { error: "请输入时间，如 14:30" };
  if (kind === "select") {
    const option = optionByText(control, text);
    return option?.error ? option : option ? { value: [option.key] } : { value: [] };
  }
  if (kind === "multiSelect") {
    const values = [...new Set(text.split(/[,，、]/).map((item) => item.trim()).filter(Boolean))];
    const parsed = values.map((item) => optionByText(control, item));
    const error = parsed.find((item) => item?.error);
    return error ? { error: error.error } : { value: parsed.filter(Boolean).map((item) => item.key) };
  }
  if (kind === "member" || kind === "relation") return { error: "请打开记录选择器选择，不能直接粘贴名称" };
  return { value: input ?? "" };
}

function validateValue(value, control, required = Boolean(control.required)) {
  if (required && (value === "" || value === null || value === undefined || (Array.isArray(value) && !value.length))) return "此字段为必填字段";
  return null;
}

function serializeValue(value, control) {
  const kind = getFieldKind(control, value);
  if (kind === "select" || kind === "multiSelect") return JSON.stringify(value || []);
  if (kind === "member") return JSON.stringify((Array.isArray(value) ? value : []).map((item) => ({ accountId: item?.accountId || item?.id || item })));
  if (kind === "relation") return JSON.stringify((Array.isArray(value) ? value : []).map((item) => ({ sid: item?.sid || item?.rowid || item?.id || item })));
  if (kind === "checkbox") return value ? 1 : 0;
  return value ?? "";
}

export function createFieldAdapter(control = {}) {
  const kind = getFieldKind(control);
  return {
    control,
    kind,
    writable: isWritableControl(control),
    options: optionsOf(control),
    display: (raw) => displayValue(control, raw),
    labels: (raw) => valueLabels(control, raw),
    relationLinks: (raw) => kind === "relation" ? relationLinks(raw) : [],
    parseEditor: (input) => parseInput(input, control),
    parseClipboard: (input) => parseInput(input, control),
    validate: (value, required = Boolean(control.required)) => validateValue(value, control, required),
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    serialize: (value) => serializeValue(value, control)
  };
}

export function getControls(runtimeConfig) {
  const controls = runtimeConfig && runtimeConfig.controls;
  return Array.isArray(controls) ? controls.filter((control) => Number(control.type) !== 22) : [];
}

export function structureHash(controls) {
  return JSON.stringify((controls || []).map((control) => [control.controlId, control.type, control.controlName, control.required, control.enumDefault, control.subType, (control.options || []).map((option) => [option.key, option.value])]));
}
