import { describe, expect, it, vi } from "vitest";
import { createDiagnostics, installGlobalDiagnostics, redact } from "./diagnostics";

describe("diagnostics", () => {
  it("redacts sensitive payloads and caps the ring buffer", () => {
    const log = createDiagnostics({ limit: 2, now: () => "now" });
    log.info("one", { rowId: "r1", fullname: "张三", nested: { value: "secret" } });
    log.info("two"); log.info("three");
    expect(log.list().map((entry) => entry.operation)).toEqual(["two", "three"]);
    expect(redact({ fullname: "张三", safe: "ok" })).toEqual({ fullname: "[REDACTED]", safe: "ok" });
  });

  it("captures global errors and can uninstall", () => {
    const listeners = {};
    const target = { addEventListener: vi.fn((name, fn) => { listeners[name] = fn; }), removeEventListener: vi.fn() };
    const log = createDiagnostics();
    const uninstall = installGlobalDiagnostics(target, log);
    listeners.error({ message: "boom", filename: "app.js" });
    listeners.unhandledrejection({ reason: new Error("nope") });
    expect(log.list()).toHaveLength(2);
    uninstall();
    expect(target.removeEventListener).toHaveBeenCalledTimes(2);
  });
});
