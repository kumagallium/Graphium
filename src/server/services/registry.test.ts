// Registry への鍵の付け方: 環境変数の鍵は環境変数の URL と同じオリジンへだけ送る
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRegistryServers } from "./registry.js";

describe("fetchRegistryServers の鍵の扱い", () => {
  const saved = { url: process.env.CRUCIBLE_API_URL, key: process.env.CRUCIBLE_API_KEY };
  const fetchMock = vi.fn(async (_u: unknown, _i?: RequestInit) => new Response("[]"));
  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    process.env.CRUCIBLE_API_URL = "http://crucible-api:8000";
    process.env.CRUCIBLE_API_KEY = "env-secret";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [k, v] of [["CRUCIBLE_API_URL", saved.url], ["CRUCIBLE_API_KEY", saved.key]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  const sentHeaders = () => (fetchMock.mock.calls[0][1]?.headers ?? {}) as Record<string, string>;

  it("環境変数と同じオリジンには環境変数の鍵を付ける", async () => {
    await fetchRegistryServers("http://crucible-api:8000/", "env-secret");
    expect(sentHeaders()["X-API-Key"]).toBe("env-secret");
    expect(fetchMock.mock.calls[0][1]?.redirect).toBe("error");
  });

  it("別オリジン（X-Registry-URL）には環境変数の鍵を付けない", async () => {
    await fetchRegistryServers("https://attacker.example", "env-secret");
    expect(sentHeaders()["X-API-Key"]).toBeUndefined();
  });

  it("別オリジンでも、利用者が明示した別の鍵はそのまま使う", async () => {
    await fetchRegistryServers("https://my-registry.example", "typed-key");
    expect(sentHeaders()["X-API-Key"]).toBe("typed-key");
  });

  it("環境変数の URL が未設定なら、環境変数の鍵はどこにも付けない", async () => {
    delete process.env.CRUCIBLE_API_URL;
    await fetchRegistryServers("https://attacker.example", "env-secret");
    expect(sentHeaders()["X-API-Key"]).toBeUndefined();
  });

  it("リダイレクトで落ちたときは console.warn で 1 行知らせ、鍵や URL を出さず空配列を返す", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(Object.assign(new TypeError("fetch failed"), { cause: new Error("unexpected redirect") }));
    const r = await fetchRegistryServers("http://crucible-api:8000/?token=abc", "env-secret");
    expect(r).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain("CRUCIBLE_API_URL");
    expect(msg).not.toContain("env-secret");
    expect(msg).not.toContain("token=abc");
    warn.mockRestore();
  });
});
