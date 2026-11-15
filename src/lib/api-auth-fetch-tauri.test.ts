// @vitest-environment jsdom
// デスクトップ版（Tauri）: アプリが起動ごとに作る合言葉を API への fetch にだけ付ける
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
vi.mock("./platform", () => ({
  isTauri: () => true,
  apiBase: () => "http://127.0.0.1:3001/api",
}));

import { __resetTauriApiTokenForTest, withApiAuth } from "./api-auth-fetch";

describe("withApiAuth（Tauri）", () => {
  const base = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("ok"));
  const sentToken = (i = 0) => new Headers(base.mock.calls[i][1]?.headers).get("x-graphium-token");
  beforeEach(() => {
    base.mockClear();
    invokeMock.mockReset();
    __resetTauriApiTokenForTest();
    localStorage.clear();
  });

  it("API には get_api_token の値を付け、invoke は 1 回だけ", async () => {
    invokeMock.mockResolvedValue("tok-1");
    const f = withApiAuth(base as unknown as typeof fetch);
    await f("http://127.0.0.1:3001/api/health");
    await f(new URL("http://127.0.0.1:3001/api/models"));
    await f(new Request("http://127.0.0.1:3001/api/x", { headers: { "X-Other": "1" } }));
    await f("http://127.0.0.1:3001/api/y", { headers: [["A", "b"]] });
    for (let i = 0; i < 4; i++) expect(sentToken(i)).toBe("tok-1");
    expect(new Headers(base.mock.calls[2][1]?.headers).get("x-other")).toBe("1");
    expect(new Headers(base.mock.calls[3][1]?.headers).get("a")).toBe("b");
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("get_api_token");
  });

  it("ほかのオリジン・API 以外には付けず、invoke もしない", async () => {
    invokeMock.mockResolvedValue("tok-1");
    const f = withApiAuth(base as unknown as typeof fetch);
    await f("https://evil.example/api/x");
    await f("http://127.0.0.1:3002/api/x");
    await f("http://127.0.0.1:3001/other");
    for (let i = 0; i < 3; i++) expect(sentToken(i)).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("設定画面の合言葉（localStorage）より、アプリの合言葉を使う", async () => {
    localStorage.setItem("graphium_server_token", "self-host");
    invokeMock.mockResolvedValue("tok-1");
    await withApiAuth(base as unknown as typeof fetch)("http://127.0.0.1:3001/api/x");
    expect(sentToken(0)).toBe("tok-1");
  });

  it("invoke が一度失敗しても、次の要求で再試行して合言葉を付ける", async () => {
    invokeMock.mockRejectedValueOnce(new Error("early")).mockResolvedValue("tok-2");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = withApiAuth(base as unknown as typeof fetch);
    await f("http://127.0.0.1:3001/api/x");
    await f("http://127.0.0.1:3001/api/x");
    expect(base.mock.calls[0][1]).toBeUndefined();
    expect(sentToken(1)).toBe("tok-2");
    warn.mockRestore();
  });

  it("呼び出し側が付けた X-Graphium-Token より、アプリの合言葉を優先する", async () => {
    invokeMock.mockResolvedValue("tok-1");
    await withApiAuth(base as unknown as typeof fetch)("http://127.0.0.1:3001/api/x", {
      headers: { "X-Graphium-Token": "stale" },
    });
    expect(sentToken(0)).toBe("tok-1");
  });

  it("body 付きの Request・FormData・signal を壊さない", async () => {
    invokeMock.mockResolvedValue("tok-1");
    const f = withApiAuth(base as unknown as typeof fetch);
    const req = new Request("http://127.0.0.1:3001/api/x", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Other": "1" },
      body: "{}",
    });
    await f(req);
    const h = new Headers(base.mock.calls[0][1]?.headers);
    expect(h.get("content-type")).toBe("application/json");
    expect(h.get("x-other")).toBe("1");
    const fd = new FormData();
    fd.append("a", "b");
    const ac = new AbortController();
    await f("http://127.0.0.1:3001/api/y", { method: "POST", body: fd, signal: ac.signal });
    expect(base.mock.calls[1][1]?.body).toBe(fd);
    expect(base.mock.calls[1][1]?.signal).toBe(ac.signal);
    expect(new Headers(base.mock.calls[1][1]?.headers).has("content-type")).toBe(false);
  });

  it("invoke が失敗したらヘッダーなしで送り、警告を出す", async () => {
    invokeMock.mockRejectedValue(new Error("nope"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await withApiAuth(base as unknown as typeof fetch)("http://127.0.0.1:3001/api/x");
    expect(base.mock.calls[0][1]).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
