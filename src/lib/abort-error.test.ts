import { describe, it, expect } from "vitest";
import { isAbortError } from "./abort-error";

describe("isAbortError", () => {
  it("DOMException の AbortError を判定する", () => {
    expect(isAbortError(new DOMException("aborted", "AbortError"))).toBe(true);
  });

  it("name === AbortError の通常 Error（Node / AI SDK）を判定する", () => {
    const err = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    expect(isAbortError(err)).toBe(true);
  });

  it("AbortController.abort() の reason（既定）を判定する", () => {
    const c = new AbortController();
    c.abort();
    expect(isAbortError(c.signal.reason)).toBe(true);
  });

  it("他のエラーは false", () => {
    expect(isAbortError(new Error("network"))).toBe(false);
    expect(isAbortError(new DOMException("timeout", "TimeoutError"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
  });
});
