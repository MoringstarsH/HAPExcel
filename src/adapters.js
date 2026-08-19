const READ_ONLY_TYPES = new Set([14, 19, 21, 22, 23, 24, 25, 28, 30, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45]);
const NATIVE_EDITOR_TYPES = new Set([14, 19, 23, 24, 41, 44]);
const DEFAULT_OPTION_COLORS = ["#3370ff", "#7f66ff", "#00b8d9", "#34c759", "#ffb020", "#f04438", "#f759ab", "#8f959e"];
const MEMBER_COLORS = ["#3370ff", "#7f66ff", "#00b8d9", "#34c759", "#ffb020", "#f04438", "#f759ab", "#8f959e"];
const NUMERIC_PRESENTATION_TYPES = new Set([6, 8, 30, 31, 37]);
const CURRENCY_PREFIXES = new Set(["¥", "￥", "$", "€", "£", "₩", "₽", "₹", "฿", "₫", "₺", "₴", "₦", "₱", "₪", "₭", "₲", "₡", "₵"]);
const CURRENCY_SYMBOL_BY_CODE = {
  CNY: "¥", RMB: "¥", USD: "$", EUR: "€", GBP: "£", JPY: "¥", KRW: "₩",
  RUB: "₽", INR: "₹", THB: "฿", VND: "₫", TRY: "₺", UAH: "₴", NGN: "₦",
  PHP: "₱", ILS: "₪", LAK: "₭", PYG: "₲", CRC: "₡", GHS: "₵", HKD: "HK$",
  MOP: "MOP$", TWD: "NT$", SGD: "S$", AUD: "A$", CAD: "C$"
};
const OPTION_TYPES = new Set([9, 10, 11]);

export function safeJson(value, fallback = value) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

export function isWritableControl(control = {}) {
  return !control.readonly && !control.disabled && !READ_ONLY_TYPES.has(Number(control.type));
}

export function getFieldKind(control = {}, rawValue) {
  const type = Number(control.type);
  if (type === 14) return "attachment";
  if ([19, 23, 24].includes(type)) return "region";
  if (type === 9 || type === 11) return "select";
  if (type === 10) return "multiSelect";
  if (type === 26) return "member";
  if (type === 27) return "department";
  if (type === 29) return "relation";
  if (type === 36) return "checkbox";
  if (type === 40) return "location";
  if (type === 41) return "richText";
  if (type === 44) return "appRole";
  if (type === 15) return "date";
  if (type === 16) return "datetime";
  if (type === 46) return "time";
  if (type === 48) return "orgRole";
  if (type === 6 || type === 8) return "number";
  if ([3, 4, 5, 7, 39, 47].includes(type)) return "formattedText";
  if (type === 2) return "text";
  if (typeof rawValue === "boolean") return "checkbox";
  if (typeof rawValue === "number") return "number";
  return "readonly";
}

function parsedOptions(value) {
  const parsed = safeJson(value, value);
  return Array.isArray(parsed) ? parsed : [];
}

function isDeletedOption(option) {
  return [true, 1, "1", "true"].includes(option?.isDeleted);
}

function normalizeOptions(value) {
  return parsedOptions(value).filter((option) => {
    if (!option || typeof option !== "object") return false;
    if (isDeletedOption(option)) return false;
    return option.key !== undefined && option.key !== null && String(option.key).trim() !== ""
      && optionLabel(option).trim() !== "";
  });
}

function optionsOf(control) { return normalizeOptions(control?.options); }

export function mergeCanonicalControlOptions(controls = [], canonicalControls = []) {
  if (!Array.isArray(canonicalControls) || !canonicalControls.length) return controls;
  const canonicalById = new Map(canonicalControls.map((control) => [control?.controlId, control]));
  return controls.map((control) => {
    const canonical = canonicalById.get(control?.controlId);
    if (!canonical) return control;
    const configuredAdvancedRaw = safeJson(control?.advancedSetting, {});
    const canonicalAdvancedRaw = safeJson(canonical?.advancedSetting, {});
    const configuredAdvanced = configuredAdvancedRaw && typeof configuredAdvancedRaw === "object" ? configuredAdvancedRaw : {};
    const canonicalAdvanced = canonicalAdvancedRaw && typeof canonicalAdvancedRaw === "object" ? canonicalAdvancedRaw : {};
    const advancedSetting = configuredAdvanced && typeof configuredAdvanced === "object"
      ? {
        ...canonicalAdvanced,
        ...configuredAdvanced,
        ...((canonicalAdvanced.defsource && !configuredAdvanced.defsource) ? { defsource: canonicalAdvanced.defsource } : {}),
        ...((canonicalAdvanced.defSource && !configuredAdvanced.defSource) ? { defSource: canonicalAdvanced.defSource } : {})
      }
      : canonicalAdvanced;
    const merged = {
      ...control,
      ...(advancedSetting && Object.keys(advancedSetting).length ? { advancedSetting } : {}),
      ...(!Object.prototype.hasOwnProperty.call(control, "defaultValue") && Object.prototype.hasOwnProperty.call(canonical, "defaultValue")
        ? { defaultValue: canonical.defaultValue }
        : {}),
      ...(!Object.prototype.hasOwnProperty.call(control, "value") && Object.prototype.hasOwnProperty.call(canonical, "value")
        ? { value: canonical.value }
        : {})
    };
    if (OPTION_TYPES.has(Number(control?.type)) && Object.prototype.hasOwnProperty.call(canonical, "options")) {
      merged.options = normalizeOptions(canonical.options);
    }
    return merged;
  });
}

function optionLabel(option) { return String(option?.value ?? option?.name ?? option?.key ?? ""); }

function optionColorEnabled(control) {
  return ![false, 0, "0", "false"].includes(control?.colorful);
}

function colorValueOf(option) {
  const raw = option?.color ?? option?.colorValue ?? option?.colorIndex;
  if (raw && typeof raw === "object") return raw.hex ?? raw.value ?? raw.color ?? raw.index;
  return raw;
}

function normalizeOptionColor(raw, index = 0) {
  if (typeof raw === "number" && Number.isFinite(raw)) return DEFAULT_OPTION_COLORS[Math.abs(raw) % DEFAULT_OPTION_COLORS.length];
  if (typeof raw === "string") {
    const value = raw.trim();
    if (/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) return value;
    if (/^(?:rgb|rgba|hsl|hsla)\([^()]+\)$/i.test(value)) return value;
    if (/^[a-z]+$/i.test(value)) return value;
    if (/^\d+$/.test(value)) return DEFAULT_OPTION_COLORS[Number(value) % DEFAULT_OPTION_COLORS.length];
  }
  return DEFAULT_OPTION_COLORS[index % DEFAULT_OPTION_COLORS.length];
}

export function optionPresentation(control, key) {
  const options = optionsOf(control);
  const optionIndex = options.findIndex((item) => String(item?.key) === String(key));
  const option = optionIndex >= 0 ? options[optionIndex] : null;
  const known = Boolean(option);
  const colored = known && optionColorEnabled(control);
  return {
    key: String(key ?? ""),
    label: known ? optionLabel(option) : "",
    color: colored ? normalizeOptionColor(colorValueOf(option), optionIndex) : null,
    colored
  };
}

function optionByText(control, text) {
  const normalized = String(text ?? "").trim();
  const matches = optionsOf(control).filter((option) => optionLabel(option).trim() === normalized);
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

export function memberItems(raw) {
  const value = safeJson(raw, raw);
  if (Array.isArray(value)) return value.map((item) => item && typeof item === "object" ? item : { accountId: item }).filter((item) => item && typeof item === "object");
  if (value && typeof value === "object") return [value];
  return [];
}

function memberColor(value) {
  let hash = 0;
  for (const character of String(value || "member")) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return MEMBER_COLORS[hash % MEMBER_COLORS.length];
}

function memberInitials(name) {
  const characters = Array.from(String(name || "未命名成员").trim()).filter(Boolean);
  return characters.slice(0, 2).join("") || "成";
}

export function memberPresentation(item, index = 0) {
  const value = item && typeof item === "object" ? item : { accountId: item };
  const fullname = String(value.fullname || value.name || value.title || value.label || "未命名成员");
  const accountId = String(value.accountId || value.id || "");
  const avatar = String(value.avatar || value.avatarUrl || value.photo || value.head || "");
  return {
    ...value,
    accountId,
    fullname,
    avatar,
    initials: memberInitials(fullname),
    color: memberColor(accountId || `${fullname}-${index}`)
  };
}

export function memberPresentations(raw) {
  return memberItems(raw).map((item, index) => memberPresentation(item, index));
}

const ENTITY_META = {
  department: { id: ["departmentId", "id"], name: ["departmentName", "fullname", "name", "title"] },
  appRole: { id: ["roleId", "id"], name: ["roleName", "name", "title"] },
  orgRole: { id: ["organizeId", "orgRoleId", "id"], name: ["organizeName", "orgRoleName", "name", "title"] }
};

function firstValue(item, keys) {
  for (const key of keys) if (item?.[key] !== undefined && item?.[key] !== null && item?.[key] !== "") return item[key];
  return "";
}

export function entityItems(raw, kind) {
  const meta = ENTITY_META[kind];
  if (!meta) return [];
  const parsed = safeJson(raw, raw);
  const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? [parsed] : [];
  return list.map((item) => {
    const value = item && typeof item === "object" ? item : {};
    return { ...value, id: String(firstValue(value, meta.id) || ""), name: String(firstValue(value, meta.name) || "未命名") };
  });
}

export function attachmentItems(raw) {
  const parsed = safeJson(raw, raw);
  const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? [parsed] : [];
  return list.map((item, index) => {
    const value = item && typeof item === "object" ? item : {};
    const name = String(value.originalFilename || value.originalFileName || value.fileName || value.name || `附件 ${index + 1}`);
    const candidateUrl = String(value.previewUrl || value.downloadUrl || value.url || value.fileUrl || value.path || "").trim();
    const url = /^(?:https?:|blob:|\/)/i.test(candidateUrl) ? candidateUrl : "";
    const extension = String(value.ext || value.extension || name.split(".").pop() || "").toLowerCase();
    const mime = String(value.mimeType || value.contentType || value.type || "");
    const image = mime.startsWith("image/") || /^(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/.test(extension);
    return { ...value, name, url, image, size: Number(value.fileSize || value.size || 0) || 0 };
  });
}

export function locationValue(raw) {
  const parsed = safeJson(raw, raw);
  const value = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!value || typeof value !== "object") return null;
  return {
    ...value,
    name: String(value.name || value.title || value.address || ""),
    address: String(value.address || value.name || value.title || ""),
    lat: String(value.lat ?? value.latitude ?? value.y ?? ""),
    lng: String(value.lng ?? value.longitude ?? value.x ?? "")
  };
}

export function richTextSummary(raw) {
  return String(raw || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ").trim();
}

function advancedSettingOf(control = {}) {
  const raw = control.advancedSetting;
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) { return {}; }
}

function numericValue(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const text = raw.trim().replace(/,/g, "");
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function currencyPrefix(control, advanced, unit) {
  if (Number(control.type) !== 8) return "";
  const candidates = [
    unit,
    control.currency,
    control.currencyCode,
    control.currencycode,
    advanced.currency,
    advanced.currencyCode,
    advanced.currencycode
  ].map((value) => String(value ?? "").trim()).filter(Boolean);
  for (const candidate of candidates) {
    const embeddedSymbol = [...CURRENCY_PREFIXES]
      .sort((left, right) => right.length - left.length)
      .find((symbol) => candidate.includes(symbol));
    if (embeddedSymbol) return embeddedSymbol;
    const code = candidate.toUpperCase().match(/(?:^|[^A-Z])([A-Z]{3})(?:[^A-Z]|$)/)?.[1]
      || (/^[A-Z]{3}$/i.test(candidate) ? candidate.toUpperCase() : "");
    if (code && CURRENCY_SYMBOL_BY_CODE[code]) return CURRENCY_SYMBOL_BY_CODE[code];
  }
  return "";
}

function affixesOf(control, advanced, percentage) {
  if (percentage) return { prefix: "", suffix: "%" };
  const explicitPrefix = String(advanced.prefix ?? "").trim();
  const explicitSuffix = String(advanced.suffix ?? "").trim();
  if (explicitPrefix || explicitSuffix) return { prefix: explicitPrefix, suffix: explicitSuffix };
  const unit = String(control.unit ?? "").trim();
  const currency = currencyPrefix(control, advanced, unit);
  if (currency) return { prefix: currency, suffix: "" };
  if (!unit) return { prefix: "", suffix: "" };
  return CURRENCY_PREFIXES.has(unit) ? { prefix: unit, suffix: "" } : { prefix: "", suffix: unit };
}

function percentageEnabled(control, advanced) {
  return [1, "1"].includes(advanced.numshow ?? advanced.showtype ?? advanced.summaryresult ?? control.numshow ?? control.showtype);
}

export function numberPresentation(control = {}, raw) {
  const type = Number(control.type);
  if (!NUMERIC_PRESENTATION_TYPES.has(type)) return null;
  if (raw === undefined || raw === null || raw === "") {
    const advanced = advancedSettingOf(control);
    const percentage = percentageEnabled(control, advanced);
    const affixes = affixesOf(control, advanced, percentage);
    return { rawValue: raw, formattedValue: "", percentage, ...affixes };
  }
  const value = numericValue(raw);
  if (value === null) return null;
  const advanced = advancedSettingOf(control);
  const percentage = percentageEnabled(control, advanced);
  const displayValue = percentage ? value * 100 : value;
  const configuredDot = Number(control.dot ?? advanced.dot);
  const hasConfiguredDot = Number.isFinite(configuredDot);
  const digits = hasConfiguredDot ? Math.max(0, Math.min(14, Math.trunc(configuredDot))) : 2;
  const minimumFractionDigits = hasConfiguredDot || type !== 6 ? digits : 0;
  const maximumFractionDigits = hasConfiguredDot || type !== 6 ? digits : 8;
  const useGrouping = ![1, "1"].includes(advanced.thousandth ?? control.thousandth);
  const formattedValue = displayValue.toLocaleString("zh-CN", {
    useGrouping,
    minimumFractionDigits,
    maximumFractionDigits
  });
  return { rawValue: raw, formattedValue, percentage, ...affixesOf(control, advanced, percentage) };
}

export function numberPresentationText(presentation) {
  if (!presentation?.formattedValue) return "";
  if (presentation.percentage) return `${presentation.formattedValue}%`;
  return [presentation.prefix, presentation.formattedValue, presentation.suffix].filter(Boolean).join(" ");
}

function regionText(raw) {
  const parsed = safeJson(raw, raw);
  if (typeof parsed === "string") return parsed;
  const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? [parsed] : [];
  return list.map((item) => item?.name || item?.title || item?.text || item?.value || "").filter(Boolean).join(" / ");
}

export function displayValue(control, raw) {
  if (raw === undefined || raw === null || raw === "") return "";
  const kind = getFieldKind(control, raw);
  if (kind === "checkbox") return raw === true || raw === 1 || raw === "1" || raw === "true" || raw === "是" || raw === "✓" ? "✓" : "";
  if (kind === "select" || kind === "multiSelect") {
    return keysFrom(raw).map((key) => optionPresentation(control, key).label).join(", ");
  }
  if (kind === "relation") {
    if (typeof raw === "number" || (typeof raw === "string" && /^\d+$/.test(raw))) return `已关联 ${raw} 条`;
    return itemLabels(relationItems(raw), ["sid", "rowid"]).join(", ");
  }
  if (kind === "member") {
    return memberPresentations(raw).map((member) => member.fullname).join(", ");
  }
  if (["department", "appRole", "orgRole"].includes(kind)) return entityItems(raw, kind).map((item) => item.name).join(", ");
  if (kind === "attachment") return attachmentItems(raw).map((item) => item.name).join(", ");
  if (kind === "location") {
    const location = locationValue(raw);
    return location ? [location.name, location.address !== location.name ? location.address : ""].filter(Boolean).join(" · ") : "";
  }
  if (kind === "region") return regionText(raw);
  if (kind === "richText") return richTextSummary(raw);
  const numericPresentation = numberPresentation(control, raw);
  if (numericPresentation) return numberPresentationText(numericPresentation);
  return String(raw);
}

export function valueLabels(control, raw) {
  const kind = getFieldKind(control, raw);
  if (kind === "select" || kind === "multiSelect") return displayValue(control, raw).split(/,\s*/).filter(Boolean);
  if (kind === "member") {
    return memberPresentations(raw).map((member) => member.fullname);
  }
  if (["department", "appRole", "orgRole"].includes(kind)) return entityItems(raw, kind).map((item) => item.name);
  if (kind === "attachment") return attachmentItems(raw).map((item) => item.name);
  if (kind === "relation") {
    const items = relationItems(raw);
    return items.length ? itemLabels(items, ["sid", "rowid"]) : displayValue(control, raw) ? [displayValue(control, raw)] : [];
  }
  return [];
}

function optionTags(control, raw) {
  return keysFrom(raw)
    .map((key) => optionPresentation(control, key))
    .filter((option) => option.label);
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
  if (["member", "department", "orgRole", "appRole", "relation", "location"].includes(kind)) return { error: "请打开原生选择器选择，不能直接粘贴文本" };
  if (["attachment", "region", "richText"].includes(kind)) return { error: "此字段请在 HAP 原生记录窗口中编辑" };
  if (kind === "formattedText") {
    const type = Number(control.type);
    if (type === 5 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return { error: "请输入有效邮箱地址" };
    if (type === 3 && !/^\+?[\d\s()-]{6,20}$/.test(text)) return { error: "请输入有效手机号码" };
    if (type === 4 && !/^\+?[\d\s()-]{5,24}(?:-\d{1,8})?$/.test(text)) return { error: "请输入有效座机号码" };
    const setting = control.advancedSetting || {};
    const min = Number(setting.minlength ?? setting.minLength);
    const max = Number(setting.maxlength ?? setting.maxLength);
    if (Number.isFinite(min) && min > 0 && text.length < min) return { error: `内容至少需要 ${min} 个字符` };
    if (Number.isFinite(max) && max > 0 && text.length > max) return { error: `内容最多允许 ${max} 个字符` };
  }
  return { value: input ?? "" };
}

function validateValue(value, control, required = Boolean(control.required)) {
  const kind = getFieldKind(control, value);
  const empty = value === "" || value === null || value === undefined || (Array.isArray(value) && !value.length);
  if (required && empty) return "此字段为必填字段";
  if (empty) return null;
  if (kind === "select" || kind === "multiSelect") {
    const parsed = safeJson(value, value);
    if (Array.isArray(parsed) && !parsed.length) return required ? "此字段为必填字段" : null;
    const keys = keysFrom(value);
    if (!keys.length) return "选项值格式无效，请重新选择";
    if (keys.some((key) => !["string", "number"].includes(typeof key) || String(key).trim() === "")) return "选项值格式无效，请重新选择";
    if (Object.prototype.hasOwnProperty.call(control, "options")) {
      const knownKeys = new Set(optionsOf(control).map((option) => String(option.key)));
      if (keys.some((key) => !knownKeys.has(String(key)))) return "包含当前字段中不存在的选项，请重新选择";
    }
  }
  if (kind === "member") {
    const items = memberItems(value);
    if (!items.length || items.some((item) => !(item.accountId || item.id))) return "成员值缺少账号 ID，请重新选择";
  }
  if (["department", "appRole", "orgRole"].includes(kind)) {
    const items = entityItems(value, kind);
    if (!items.length || items.some((item) => !item.id)) return "组织实体值缺少 ID，请重新选择";
  }
  if (kind === "relation") {
    const items = relationItems(value);
    if (!items.length || items.some((item) => !(item?.sid || item?.rowid || item?.id))) return "关联记录值缺少记录 ID，请重新选择";
  }
  if (kind === "location") {
    const parsed = safeJson(value, null);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "定位值格式无效，请重新选择";
  }
  return null;
}

function serializeValue(value, control) {
  const kind = getFieldKind(control, value);
  if (kind === "select" || kind === "multiSelect") return JSON.stringify(keysFrom(value));
  if (kind === "member") return JSON.stringify(memberItems(value).map((item) => ({ accountId: item.accountId || item.id })));
  if (kind === "department") return JSON.stringify(entityItems(value, kind).map((item) => ({ departmentId: item.id })));
  if (kind === "orgRole") return JSON.stringify(entityItems(value, kind).map((item) => ({ organizeId: item.id })));
  if (kind === "relation") return JSON.stringify(relationItems(value).map((item) => ({ sid: item?.sid || item?.rowid || item?.id })));
  if (kind === "location") return value ? JSON.stringify(safeJson(value, value)) : "";
  if (kind === "checkbox") return value ? 1 : 0;
  return value ?? "";
}

function emptyValueForKind(kind) {
  if (kind === "checkbox") return false;
  if (["select", "multiSelect", "member", "department", "appRole", "orgRole", "relation"].includes(kind)) return [];
  return "";
}

function isEmptyValueForKind(kind, raw) {
  const value = safeJson(raw, raw);
  if (value === "" || value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (kind === "location") return !locationValue(value);
  return false;
}

function copyValue(value) {
  if (value === null || value === undefined || typeof value !== "object") return value;
  if (typeof globalThis.structuredClone === "function") {
    try { return globalThis.structuredClone(value); } catch (_) { /* use recursive fallback */ }
  }
  if (Array.isArray(value)) return value.map(copyValue);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyValue(item)]));
}

export function createFieldAdapter(control = {}) {
  const kind = getFieldKind(control);
  return {
    control,
    kind,
    writable: isWritableControl(control),
    nativeEditor: NATIVE_EDITOR_TYPES.has(Number(control.type)),
    options: optionsOf(control),
    optionTag: (key) => optionPresentation(control, key),
    optionTags: (raw) => optionTags(control, raw),
    memberTags: (raw) => kind === "member" ? memberPresentations(raw) : [],
    entityTags: (raw) => ["department", "appRole", "orgRole"].includes(kind) ? entityItems(raw, kind) : [],
    attachments: (raw) => kind === "attachment" ? attachmentItems(raw) : [],
    locationValue: (raw) => kind === "location" ? locationValue(raw) : null,
    numberPresentation: (raw) => numberPresentation(control, raw),
    display: (raw) => displayValue(control, raw),
    clipboardText: (raw) => numberPresentation(control, raw) ? String(raw ?? "").replace(/,/g, "") : displayValue(control, raw),
    labels: (raw) => valueLabels(control, raw),
    relationLinks: (raw) => kind === "relation" ? relationLinks(raw) : [],
    emptyValue: () => emptyValueForKind(kind),
    isEmpty: (raw) => isEmptyValueForKind(kind, raw),
    parseEditor: (input) => parseInput(input, control),
    parseClipboard: (input) => parseInput(input, control),
    validate: (value, required = Boolean(control.required)) => validateValue(value, control, required),
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    copyValue,
    serialize: (value) => serializeValue(value, control)
  };
}

export function getControls(runtimeConfig) {
  const controls = runtimeConfig && runtimeConfig.controls;
  return Array.isArray(controls) ? controls.filter((control) => Number(control.type) !== 22) : [];
}

export function structureHash(controls) {
  return JSON.stringify((controls || []).map((control) => [control.controlId, control.type, control.controlName, control.required, control.enumDefault, control.subType, optionsOf(control).map((option) => [option.key, option.value])]));
}
