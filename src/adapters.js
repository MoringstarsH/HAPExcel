const READ_ONLY_TYPES = new Set([14, 21, 22, 25, 30, 31, 32, 33, 34, 35, 37, 38, 39, 40, 41, 42, 43, 44, 45, 47, 48]);

export function safeJson(value, fallback = value) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
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
  if (type === 6 || type === 8) return "number";
  if ([2, 3, 4, 5, 7].includes(type)) return "text";
  if (typeof rawValue === "boolean") return "checkbox";
  if (typeof rawValue === "number") return "number";
  return "readonly";
}

function optionsOf(control) {
  return Array.isArray(control.options) ? control.options : [];
}

function optionByText(control, text) {
  const normalized = String(text ?? "").trim();
  const matches = optionsOf(control).filter((option) => String(option.value ?? option.name ?? "").trim() === normalized);
  if (matches.length > 1) return { error: "存在同名选项，请通过原生选择器选择" };
  if (!matches.length && normalized) return { error: `未找到选项“${normalized}”` };
  return matches[0] || null;
}

function keysFrom(raw) {
  const value = safeJson(raw, raw);
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function displayRelation(raw) {
  if (typeof raw === "number" || (typeof raw === "string" && /^\d+$/.test(raw))) return `已关联 ${raw} 条`;
  const rows = safeJson(raw, raw);
  if (!Array.isArray(rows)) return String(raw ?? "");
  return rows.map((item) => item.name || item.title || item.rowid || item.sid || "").filter(Boolean).join(", ");
}

function display(control, raw) {
  if (raw === undefined || raw === null || raw === "") return "";
  const kind = getFieldKind(control, raw);
  if (kind === "checkbox") return raw === true || raw === 1 || raw === "1" || raw === "true" || raw === "是" || raw === "✓" ? "✓" : "";
  if (kind === "select") {
    const key = keysFrom(raw)[0];
    const option = optionsOf(control).find((item) => item.key === key);
    return option ? option.value ?? option.name : String(key ?? "");
  }
  if (kind === "multiSelect") {
    return keysFrom(raw).map((key) => optionsOf(control).find((item) => item.key === key)?.value ?? key).join(", ");
  }
  if (kind === "relation") return displayRelation(raw);
  if (kind === "member") {
    const members = safeJson(raw, raw);
    return Array.isArray(members) ? members.map((item) => item.fullname || item.name || item.accountId || item).join(", ") : String(raw);
  }
  return String(raw);
}

export function createFieldAdapter(control = {}) {
  const kind = getFieldKind(control);
  const read = (raw) => raw === undefined ? "" : raw;
  const parseEditor = (input) => parseInput(input, control);
  return {
    control,
    kind,
    read,
    display: (raw) => display(control, raw),
    parseEditor,
    parseClipboard: parseEditor,
    validate: (value, required = Boolean(control.required)) => validateValue(value, control, required),
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    serialize: (value) => serializeValue(value, control)
  };
}

function parseInput(input, control) {
  const kind = getFieldKind(control);
  const text = String(input ?? "").trim();
  if (kind === "readonly" || READ_ONLY_TYPES.has(Number(control.type))) return { error: "此字段为只读字段" };
  if (!text) return { value: kind === "checkbox" ? false : "" };
  if (kind === "number") return /^-?(?:\d+\.?\d*|\.\d+)$/.test(text) ? { value: Number(text) } : { error: "请输入有效数字" };
  if (kind === "checkbox") {
    const normalized = text.toLowerCase();
    if (["1", "是", "true", "✓", "√", "yes"].includes(normalized)) return { value: true };
    if (["0", "否", "false", "no"].includes(normalized)) return { value: false };
    return { error: "复选框只接受 1/0、是/否、true/false 或勾选符号" };
  }
  if (kind === "date" || kind === "datetime") {
    const match = text.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!match) return { error: "请输入明确的日期格式，如 2026-08-14" };
    const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    const validDate = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
    const validTime = match[4] === undefined || (Number(match[4]) < 24 && Number(match[5]) < 60 && (!match[6] || Number(match[6]) < 60));
    return validDate && validTime ? { value: text } : { error: "日期或时间无效" };
  }
  if (kind === "select") {
    const option = optionByText(control, text);
    return option?.error ? option : option ? { value: [option.key] } : { value: [text] };
  }
  if (kind === "multiSelect") {
    const values = [...new Set(text.split(/[,，、]/).map((item) => item.trim()).filter(Boolean))];
    const parsed = values.map((item) => optionByText(control, item));
    const error = parsed.find((item) => item?.error);
    return error ? { error: error.error } : { value: parsed.map((item) => item.key) };
  }
  if (kind === "member" || kind === "relation") return { error: "请点击选择器选择，不能直接粘贴文本" };
  return { value: input ?? "" };
}

function validateValue(value, control, required) {
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

export function getControls(runtimeConfig) {
  const controls = runtimeConfig && runtimeConfig.controls;
  return Array.isArray(controls) ? controls : [];
}

export function structureHash(controls) {
  return JSON.stringify((controls || []).map((c) => [c.controlId, c.type, c.controlName, c.required, (c.options || []).map((o) => [o.key, o.value]) ]));
}
