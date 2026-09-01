// createApp の CORS 設定の回帰テスト
// フロント（features/ai-assistant/api.ts の apiHeaders）が送るカスタムヘッダーが
// preflight で許可されることを検証する。allowHeaders から漏れると Tauri 版
// （tauri://localhost → 127.0.0.1:3001 の cross-origin）で全 API が落ちる。
// Web 版は vite proxy の same-origin で CORS が発生せず発症しないため、
// このテストが唯一の自動検知点になる。

import { describe, it, expect } from "vitest";
import { createApp } from "./app.js";

// apiHeaders（と認証系）が付けうるカスタムヘッダーの一覧。
// features/ai-assistant/api.ts にヘッダーを追加したらここにも追加すること。
const FRONTEND_CUSTOM_HEADERS = [
  "content-type",
  "x-mcp-servers",
  "x-llm-api-key",
  "x-registry-url",
  "x-graphium-token",
  "x-api-key",
];

describe("CORS preflight", () => {
  it("フロントが送る全カスタムヘッダーを Tauri origin の preflight で許可する", async () => {
    const app = createApp({ mode: "node" });
    const res = await app.request("http://localhost/api/models", {
      method: "OPTIONS",
      headers: {
        Origin: "tauri://localhost",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": FRONTEND_CUSTOM_HEADERS.join(","),
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("tauri://localhost");

    const allowed = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    for (const header of FRONTEND_CUSTOM_HEADERS) {
      expect(allowed, `allowHeaders に ${header} が無い（app.ts の cors 設定を更新すること）`).toContain(header);
    }
  });
});

// ── Host 検証（DNS リバインディング対策）──
//
// 127.0.0.1 で待つだけでは足りない。攻撃者のドメインを一旦自分の IP に解決させ、
// 被害者がページを開いた後に 127.0.0.1 へ貼り替えると、ブラウザから見て同一オリジンの
// まま届く（CORS は効かない）。そのとき Host は攻撃者のドメインなので、そこで弾く。

describe("Host 検証", () => {
  const call = (host: string | null, env?: string) => {
    const prev = process.env.GRAPHIUM_ALLOWED_HOSTS;
    if (env === undefined) delete process.env.GRAPHIUM_ALLOWED_HOSTS;
    else process.env.GRAPHIUM_ALLOWED_HOSTS = env;
    const app = createApp({ mode: "node" });
    const headers: Record<string, string> = {};
    if (host !== null) headers.Host = host;
    const res = app.request("http://placeholder/api/health", { headers });
    if (prev === undefined) delete process.env.GRAPHIUM_ALLOWED_HOSTS;
    else process.env.GRAPHIUM_ALLOWED_HOSTS = prev;
    return res;
  };

  it("ループバックの Host は通す", async () => {
    for (const h of ["localhost:3001", "127.0.0.1:3001", "localhost", "127.0.0.1", "[::1]:3001"]) {
      expect((await call(h)).status, h).not.toBe(403);
    }
  });

  it("攻撃者ドメインの Host は 403 で落とす", async () => {
    for (const h of ["evil.example", "evil.example:3001", "attacker.test:5174"]) {
      expect((await call(h)).status, h).toBe(403);
    }
  });

  it("LAN の IP も既定では通さない（バインドを広げただけで開かない）", async () => {
    expect((await call("192.168.1.5:5174")).status).toBe(403);
  });

  it("GRAPHIUM_ALLOWED_HOSTS に書けば明示的に開けられる", async () => {
    expect((await call("192.168.1.5:5174", "192.168.1.5")).status).not.toBe(403);
    expect((await call("nas.local:5174", "nas.local:5174")).status).not.toBe(403);
    // 列挙していない別ホストは開かない
    expect((await call("evil.example", "192.168.1.5")).status).toBe(403);
  });

  it("Host ヘッダーが無ければ URL のホストで見る（そこも許可外なら通さない）", async () => {
    expect((await call(null)).status).toBe(403);
  });

  it("vercel モードでは検証しない（公開ドメインで来るため）", async () => {
    const app = createApp({ mode: "vercel" });
    const res = await app.request("http://placeholder/api/health", {
      headers: { Host: "graphium.vercel.app" },
    });
    expect(res.status).not.toBe(403);
  });
});
