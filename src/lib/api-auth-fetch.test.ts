// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isApiTarget, withApiAuth } from "./api-auth-fetch";

describe("withApiAuth", () => {
  const base = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("ok"));
  beforeEach(() => {
    base.mockClear();
    localStorage.setItem("graphium_server_token", "secret-token");
  });
  afterEach(() => localStorage.clear());

  const sentToken = (i = 0) => new Headers(base.mock.calls[i][1]?.headers).get("x-graphium-token");

  it("同一オリジンの /api/ へ合言葉を足す（string / URL / Request）", async () => {
    const f = withApiAuth(base as unknown as typeof fetch);
    await f("/api/storage/notes");
    expect(sentToken(0)).toBe("secret-token");
    await f(new URL("/api/models", location.origin));
    expect(sentToken(1)).toBe("secret-token");
    await f(new Request(new URL("/api/health", location.origin), { headers: { "X-Other": "1" } }));
    expect(sentToken(2)).toBe("secret-token");
    expect(new Headers(base.mock.calls[2][1]?.headers).get("x-other")).toBe("1");
  });

  it("ほかのオリジンには足さない", async () => {
    const f = withApiAuth(base as unknown as typeof fetch);
    await f("https://evil.example/api/x");
    await f("https://evil.example/", { headers: { a: "b" } });
    await f("//evil.example/api/x");
    await f("/not-api/x");
    for (let i = 0; i < 4; i++) expect(sentToken(i)).toBeNull();
  });

  it("呼び出し側が指定済みならそのまま、トークンが無ければ何もしない", async () => {
    const f = withApiAuth(base as unknown as typeof fetch);
    await f("/api/x", { headers: { "X-Graphium-Token": "mine" } });
    expect(sentToken(0)).toBe("mine");
    localStorage.clear();
    await f("/api/x");
    expect(base.mock.calls[1][1]).toBeUndefined();
  });

  it("isApiTarget", () => {
    expect(isApiTarget("/api/a")).toBe(true);
    expect(isApiTarget("/apix/a")).toBe(false);
  });
});
