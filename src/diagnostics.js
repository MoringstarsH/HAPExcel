const DEFAULT_LIMIT = 200;
const SENSITIVE_KEY = /(value|values|name|title|fullname|phone|email|address|token|secret|password|receiveControls|newOldControl)/i;

function errorShape(error) {
  if (!error) return {};
  if (typeof error === "string") return { message: error };
  return { name: error.name, message: error.message || String(error), stack: error.stack, code: error.code };
}

export function redact(value, key = "", depth = 0) {
  if (value === undefined || value === null) return value;
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (depth > 5) return "[TRUNCATED]";
  if (value instanceof Error) return errorShape(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, "", depth + 1));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 80).map(([childKey, child]) => [childKey, redact(child, childKey, depth + 1)]));
  if (typeof value === "string" && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

export function createDiagnostics({ limit = DEFAULT_LIMIT, now = () => new Date().toISOString() } = {}) {
  let entries = [];
  const listeners = new Set();
  const publish = () => listeners.forEach((listener) => listener(entries));
  return {
    record(level, operation, details = {}) {
      const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, time: now(), level, operation, ...redact(details) };
      entries = [...entries, entry].slice(-limit);
      publish();
      return entry;
    },
    error(operation, error, details = {}) { return this.record("error", operation, { ...details, error: errorShape(error) }); },
    info(operation, details = {}) { return this.record("info", operation, details); },
    list() { return [...entries]; },
    clear() { entries = []; publish(); },
    export() { return JSON.stringify({ exportedAt: now(), entries }, null, 2); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  };
}

export const diagnostics = createDiagnostics();

export function installGlobalDiagnostics(target = window, log = diagnostics) {
  const onError = (event) => log.error("window.error", event.error || event.message, { source: event.filename, line: event.lineno, column: event.colno });
  const onRejection = (event) => log.error("window.unhandledrejection", event.reason);
  target.addEventListener?.("error", onError);
  target.addEventListener?.("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener?.("error", onError);
    target.removeEventListener?.("unhandledrejection", onRejection);
  };
}
