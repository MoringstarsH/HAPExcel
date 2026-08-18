const SYSTEM_CONTROL_IDS = new Set([
  "rowid", "ownerid", "caid", "ctime", "utime", "uaid",
  "wfname", "wfcuaids", "wfcaid", "wfctime", "wfrtime",
  "wfcotime", "wfdtime", "wfftime", "wfstatus"
]);

function fieldIdOf(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  return value.controlId || value.id || value.value || "";
}

function fieldIds(values) {
  return (Array.isArray(values) ? values : [])
    .map(fieldIdOf)
    .filter(Boolean);
}

export function isBusinessControl(control = {}) {
  const id = String(control.controlId || "");
  return Boolean(id) && Number(control.type) !== 22 && !SYSTEM_CONTROL_IDS.has(id) && !id.startsWith("wf");
}

export function resolveVisibleControls({ controls = [], view = {}, showFields = [] } = {}) {
  const hidden = new Set(fieldIds(view.controls));
  const available = controls.filter((control) => Number(control.type) !== 22 && !hidden.has(control.controlId));
  const availableById = new Map(available.map((control) => [control.controlId, control]));
  const requested = [...new Set(fieldIds(showFields))];
  const configured = requested.map((id) => availableById.get(id)).filter(Boolean);
  const invalidIds = requested.filter((id) => !availableById.has(id));

  if (configured.length) return { controls: configured, source: "plugin", invalidIds };

  const business = available.filter(isBusinessControl);
  return {
    controls: business.length ? business : available,
    source: requested.length ? "fallback-invalid" : "fallback-business",
    invalidIds
  };
}

export function hiddenErrorFieldNames(errors, allControls, visibleControls) {
  const visible = new Set(visibleControls.map((control) => control.controlId));
  const names = new Map(allControls.map((control) => [control.controlId, control.controlName || control.controlId]));
  const hidden = new Set();
  errors.forEach((cellErrors) => Object.keys(cellErrors || {}).forEach((fieldId) => {
    if (!visible.has(fieldId)) hidden.add(names.get(fieldId) || fieldId);
  }));
  return [...hidden];
}
