// createApp の CORS 設定の回帰テスト
// フロント（features/ai-assistant/api.ts の apiHeaders）が送るカスタムヘッダーが
// preflight で許可されることを検証する。allowHeaders から漏れると Tauri 版
// （tauri://localhost → 127.0.0.1:3001 の cross-origin）で全 API が落ちる。
// Web 版は vite proxy の same-origin で CORS が発生せず発症しないため、
// このテストが唯一の自動検知点になる。

import { describe, it, expect, afterEach } from "vitest";
import { authCookieValue, desktopSidecarProof } from "./auth-token.js";
import { createApp, isAllowedWriteOrigin } from "./app.js";

// apiHeaders（と認証系）が付けうるカスタムヘッダーの一覧。
// features/ai-assistant/api.ts にヘッダーを追加したらここにも追加すること。
const FRONTEND_CUSTOM_HEADERS = [
  "content-type",
  "x-mcp-servers",
  "x-llm-api-key",
  "x-registry-url",
  "x-graphium-token",
  "x-registry-key",
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

describe("他サイトからの書き込み系の要求（CSRF）", () => {
  const app = createApp({ mode: "node" });
  // 他のサイトが preflight 無しで送れる形（text/plain）。MCP の接続テストは stdio を起動するので、
  // 届けば任意コマンドの実行になる。存在しないコマンドを渡し、403 で止まることだけを見る。
  const body = JSON.stringify({ type: "stdio", name: "x", command: "/nonexistent/graphium-csrf-probe" });

  it("他サイトの Origin が付いた POST は 403", async () => {
    const res = await app.request("http://127.0.0.1:3001/api/mcp/test", {
      method: "POST",
      headers: { Host: "127.0.0.1:3001", Origin: "https://evil.example", "Content-Type": "text/plain" },
      body,
    });
    expect(res.status).toBe(403);
  });

  it('Origin が "null"（サンドボックスの iframe・file://）でも 403', async () => {
    const res = await app.request("http://127.0.0.1:3001/api/mcp/test", {
      method: "POST",
      headers: { Host: "127.0.0.1:3001", Origin: "null", "Content-Type": "text/plain" },
      body,
    });
    expect(res.status).toBe(403);
  });

  it("Tauri の WebView からの POST は通る", async () => {
    const res = await app.request("http://127.0.0.1:3001/api/mcp/test", {
      method: "POST",
      headers: { Host: "127.0.0.1:3001", Origin: "tauri://localhost", "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400); // 守りは通過し、中身の検査で 400
  });

  it("GET は Origin に関係なく通す（応答を読むのは CORS が止める）", async () => {
    const res = await app.request("http://127.0.0.1:3001/api/health", {
      headers: { Host: "127.0.0.1:3001", Origin: "https://evil.example" },
    });
    expect(res.status).not.toBe(403);
  });

  it.each([
    [undefined, "/api/mcp/test", true], // ブラウザ以外（同梱の MCP サーバー・CLI）
    ["http://localhost:5180", "/api/mcp/test", false], // ループバックの任意ポートは信頼しない
    ["http://127.0.0.1:8000", "/api/mcp/test", false],
    ["http://127.0.0.1:5174", "/api/mcp/test", false], // CORS_ORIGINS に無ければ断る
    ["http://localhost:5174", "/api/mcp/test", true], // CORS_ORIGINS の既定（tauri dev）
    ["http://tauri.localhost", "/api/mcp/test", true], // Windows の WebView2
    ["https://evil.example", "/api/mcp/test", false],
    ["http://localhost.evil.example", "/api/mcp/test", false],
    ["http://127.0.0.1.evil.example:3001", "/api/mcp/test", false],
    ["chrome-extension://abcdefghijklmnopabcdefghijklmnop", "/api/clip", true],
    ["chrome-extension://abcdefghijklmnopabcdefghijklmnop", "/api/clip/pair", true],
    ["chrome-extension://abcdefghijklmnopabcdefghijklmnop", "/api/clipboard", false],
    ["chrome-extension://abcdefghijklmnopabcdefghijklmnop", "/api/mcp/test", false],
    ["https://graphium.example", "/api/mcp/test", false],
  ])("Origin %s → %s は %s", (origin, path, expected) => {
    expect(
      isAllowedWriteOrigin({ origin, path, host: "127.0.0.1:3001", allowedOrigins: ["tauri://localhost", "http://tauri.localhost", "http://localhost:5174"] }),
    ).toBe(expected);
  });

  it("セルフホストで画面と API が同じオリジンなら通す", () => {
    expect(
      isAllowedWriteOrigin({
        origin: "https://graphium.example",
        path: "/api/mcp/test",
        host: "graphium.example",
        allowedOrigins: [],
      }),
    ).toBe(true);
  });
});

describe("API の応答を文書として開いても実行させない", () => {
  const app = createApp({ mode: "node" });

  it("JSON の応答にも CSP sandbox と nosniff が付く", async () => {
    const res = await app.request("http://127.0.0.1:3001/api/health", { headers: { Host: "127.0.0.1:3001" } });
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("拡張機能に開けるのはクリップの送信とペアリングの申し込みだけ", () => {
    const ext = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
    const allowed = (path: string) =>
      isAllowedWriteOrigin({ origin: ext, path, host: "127.0.0.1:3001", allowedOrigins: [] });
    expect(allowed("/api/clip")).toBe(true);
    expect(allowed("/api/clip/pair")).toBe(true);
    expect(allowed("/api/clip/pair/123e4567")).toBe(true);
    expect(allowed("/api/clip/pair-requests/123e4567")).toBe(false); // 承認は利用者の画面から
    expect(allowed("/api/clip/pairing/reset")).toBe(false);
    expect(allowed("/api/clip/inbox/abc")).toBe(false);
  });
});

describe("合言葉（GRAPHIUM_AUTH_TOKEN）は全 API に効く", () => {
  const prev = process.env.GRAPHIUM_AUTH_TOKEN;
  afterEach(() => {
    if (prev === undefined) delete process.env.GRAPHIUM_AUTH_TOKEN;
    else process.env.GRAPHIUM_AUTH_TOKEN = prev;
  });
  const H = { Host: "127.0.0.1:3001" };
  const get = (app: ReturnType<typeof createApp>, path: string, headers: Record<string, string> = {}) =>
    app.request(`http://127.0.0.1:3001${path}`, { headers: { ...H, ...headers } });

  it("未設定なら素通し", async () => {
    delete process.env.GRAPHIUM_AUTH_TOKEN;
    const res = await get(createApp({ mode: "node" }), "/api/models");
    expect(res.status).toBe(200);
  });

  it("設定時、storage 以外（models・tools・mcp・url）も合言葉なしは 401", async () => {
    process.env.GRAPHIUM_AUTH_TOKEN = "s3cret-token";
    const app = createApp({ mode: "node" });
    for (const path of ["/api/models", "/api/tools", "/api/url/image-proxy?url=http://example.com/a.png"]) {
      expect((await get(app, path)).status).toBe(401);
    }
    const post = await app.request("http://127.0.0.1:3001/api/mcp/test", {
      method: "POST",
      headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ command: "touch", args: ["/tmp/x"] }),
    });
    expect(post.status).toBe(401);
    expect((await get(app, "/api/models", { "X-Graphium-Token": "wrong" })).status).toBe(401);
  });

  it("ヘッダーで通り、Cookie が配られ、その Cookie でも通る", async () => {
    process.env.GRAPHIUM_AUTH_TOKEN = "s3cret-token";
    const app = createApp({ mode: "node" });
    const ok = await get(app, "/api/models", { "X-Graphium-Token": "s3cret-token" });
    expect(ok.status).toBe(200);
    const cookie = ok.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`graphium_auth=${authCookieValue("s3cret-token")}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toContain("Path=/api");
    expect(cookie).not.toMatch(/Secure/i);
    const viaCookie = await get(app, "/api/models", { Cookie: `graphium_auth=${authCookieValue("s3cret-token")}` });
    expect(viaCookie.status).toBe(200);
    // 合言葉そのものを Cookie に入れても通らない
    expect((await get(app, "/api/models", { Cookie: "graphium_auth=s3cret-token" })).status).toBe(401);
  });

  it("検査しない口: capabilities・health（内部の値は出さない）・拡張機能の口", async () => {
    process.env.GRAPHIUM_AUTH_TOKEN = "s3cret-token";
    const app = createApp({ mode: "node" });
    expect((await get(app, "/api/storage/capabilities")).status).toBe(200);
    // HEAD も合言葉なしで通る（storage.ts の isCapabilitiesRequest と揃える）
    expect((await app.request("/api/storage/capabilities", { method: "HEAD" })).status).toBe(200);
    // 別のパスの HEAD は通さない
    expect((await app.request("/api/models", { method: "HEAD" })).status).toBe(401);
    const health = await get(app, "/api/health");
    expect(health.status).toBe(200);
    const body = (await health.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("dataDir");
    expect(body).not.toHaveProperty("pid");
    // HEAD も合言葉なしで通る（応答は GET と同じ縮約）
    const head = await app.request("/api/health", { method: "HEAD" });
    expect(head.status).toBe(200);
    const ping = await get(app, "/api/clip/ping");
    expect(((await ping.json()) as { error: string }).error).not.toBe("Authentication failed");
    const pr = await get(app, "/api/clip/pair-requests");
    expect(((await pr.json()) as { error: string }).error).toBe("Authentication failed");
  });
});

describe("デスクトップ版（GRAPHIUM_DESKTOP=1）の合言葉", () => {
  const prevToken = process.env.GRAPHIUM_AUTH_TOKEN;
  const prevDesktop = process.env.GRAPHIUM_DESKTOP;
  const restore = () => {
    if (prevToken === undefined) delete process.env.GRAPHIUM_AUTH_TOKEN;
    else process.env.GRAPHIUM_AUTH_TOKEN = prevToken;
    if (prevDesktop === undefined) delete process.env.GRAPHIUM_DESKTOP;
    else process.env.GRAPHIUM_DESKTOP = prevDesktop;
  };
  afterEach(restore);
  const H = { Host: "127.0.0.1:3001" };
  const get = (app: ReturnType<typeof createApp>, path: string, headers: Record<string, string> = {}) =>
    app.request(`http://127.0.0.1:3001${path}`, { headers: { ...H, ...headers } });
  const TOKEN = "desktop-test-token";

  it("(a)(b) 合言葉なしは 401、合言葉つきは通る", async () => {
    process.env.GRAPHIUM_AUTH_TOKEN = TOKEN;
    process.env.GRAPHIUM_DESKTOP = "1";
    const app = createApp({ mode: "node" });
    expect((await get(app, "/api/models")).status).toBe(401);
    expect((await get(app, "/api/models", { "X-Graphium-Token": TOKEN })).status).toBe(200);
  });

  it("(c) 画像・PDF の中継の GET / HEAD は合言葉なしで 401 にならない（ほかの url は 401）", async () => {
    process.env.GRAPHIUM_AUTH_TOKEN = TOKEN;
    process.env.GRAPHIUM_DESKTOP = "1";
    const app = createApp({ mode: "node" });
    // url を付けない（外へ出ない）。ハンドラまで届けば 401 以外が返る
    expect((await get(app, "/api/url/image-proxy")).status).not.toBe(401);
    expect((await get(app, "/api/url/pdf-proxy")).status).not.toBe(401);
    expect((await app.request("/api/url/image-proxy", { method: "HEAD", headers: H })).status).not.toBe(401);
    expect((await get(app, "/api/url/reader?url=http://example.com")).status).toBe(401);
    expect((await get(app, "/api/storage/notes")).status).toBe(401);
  });

  it("合言葉なしの pdf-proxy はループバック・LAN 宛を 403 で止め、合言葉つきは止めない", async () => {
    process.env.GRAPHIUM_AUTH_TOKEN = TOKEN;
    process.env.GRAPHIUM_DESKTOP = "1";
    const app = createApp({ mode: "node" });
    const target = encodeURIComponent("http://127.0.0.1:1/secret");
    expect((await get(app, `/api/url/pdf-proxy?url=${target}`)).status).toBe(403);
    expect((await get(app, `/api/url/pdf-proxy?url=${encodeURIComponent("http://192.168.0.1/a.pdf")}`)).status).toBe(403);
    // 合言葉つきは metadata-only のまま（403 にならず、接続できず 502）
    expect((await get(app, `/api/url/pdf-proxy?url=${target}`, { "X-Graphium-Token": TOKEN })).status).toBe(502);
  });

  it("デスクトップ版はヘッダーで通っても Cookie を配らない（セルフホストは配る）", async () => {
    process.env.GRAPHIUM_AUTH_TOKEN = TOKEN;
    process.env.GRAPHIUM_DESKTOP = "1";
    const d = await get(createApp({ mode: "node" }), "/api/models", { "X-Graphium-Token": TOKEN });
    expect(d.headers.get("set-cookie")).toBeNull();
    delete process.env.GRAPHIUM_DESKTOP;
    const s = await get(createApp({ mode: "node" }), "/api/models", { "X-Graphium-Token": TOKEN });
    expect(s.headers.get("set-cookie")).toContain("graphium_auth=");
  });

  it("health は、合言葉なしの challenge に証明を返す（合言葉・dataDir は出さない）", async () => {
    process.env.GRAPHIUM_AUTH_TOKEN = TOKEN;
    process.env.GRAPHIUM_DESKTOP = "1";
    const app = createApp({ mode: "node" });
    const challenge = "0f".repeat(32);
    const res = await get(app, `/api/health?challenge=${challenge}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(body.proof).toBe(desktopSidecarProof(challenge));
    expect(body.proof).toMatch(/^[0-9a-f]{64}$/);
    expect(text).not.toContain(TOKEN);
    expect(body).not.toHaveProperty("dataDir");
    // challenge なし・形の違う challenge には証明を付けない
    expect((await (await get(app, "/api/health")).json()) as object).not.toHaveProperty("proof");
    expect((await (await get(app, "/api/health?challenge=abc")).json()) as object).not.toHaveProperty("proof");
  });

  it("セルフホストの health は challenge に証明を返さない", async () => {
    process.env.GRAPHIUM_AUTH_TOKEN = TOKEN;
    delete process.env.GRAPHIUM_DESKTOP;
    const app = createApp({ mode: "node" });
    const res = await get(app, `/api/health?challenge=${"0f".repeat(32)}`);
    expect((await res.json()) as object).not.toHaveProperty("proof");
    const authed = await get(app, `/api/health?challenge=${"0f".repeat(32)}`, { "X-Graphium-Token": TOKEN });
    expect((await authed.json()) as object).not.toHaveProperty("proof");
  });

  it("(d) GRAPHIUM_DESKTOP なしでは中継も 401", async () => {
    process.env.GRAPHIUM_AUTH_TOKEN = TOKEN;
    delete process.env.GRAPHIUM_DESKTOP;
    const app = createApp({ mode: "node" });
    expect((await get(app, "/api/url/image-proxy")).status).toBe(401);
    expect((await get(app, "/api/url/pdf-proxy")).status).toBe(401);
  });

  it("(e) 未認証の health は pid と desktop だけ返し、dataDir・version は返さない", async () => {
    process.env.GRAPHIUM_AUTH_TOKEN = TOKEN;
    process.env.GRAPHIUM_DESKTOP = "1";
    const app = createApp({ mode: "node" });
    const body = (await (await get(app, "/api/health")).json()) as Record<string, unknown>;
    expect(typeof body.pid).toBe("number");
    expect(body.desktop).toBe(true);
    expect(body).not.toHaveProperty("dataDir");
    expect(body).not.toHaveProperty("version");
    expect(body).not.toHaveProperty("missingKeyModels");
    // 認証済みは従来どおり dataDir を含む
    const authed = (await (await get(app, "/api/health", { "X-Graphium-Token": TOKEN })).json()) as Record<string, unknown>;
    expect(authed).toHaveProperty("dataDir");
  });

  it("デスクトップ版は capabilities で合言葉の入力を求めない", async () => {
    process.env.GRAPHIUM_AUTH_TOKEN = TOKEN;
    process.env.GRAPHIUM_DESKTOP = "1";
    const body = (await (await get(createApp({ mode: "node" }), "/api/storage/capabilities")).json()) as { requiresAuth: boolean };
    expect(body.requiresAuth).toBe(false);
    delete process.env.GRAPHIUM_DESKTOP;
    const self = (await (await get(createApp({ mode: "node" }), "/api/storage/capabilities")).json()) as { requiresAuth: boolean };
    expect(self.requiresAuth).toBe(true);
  });

  it("(f) 拡張機能の口は合言葉なしで届く", async () => {
    process.env.GRAPHIUM_AUTH_TOKEN = TOKEN;
    process.env.GRAPHIUM_DESKTOP = "1";
    const app = createApp({ mode: "node" });
    const ping = await get(app, "/api/clip/ping");
    expect(((await ping.json()) as { error: string }).error).not.toBe("Authentication failed");
    const post = await app.request("http://127.0.0.1:3001/api/clip", {
      method: "POST",
      headers: { ...H, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(((await post.json()) as { error: string }).error).not.toBe("Authentication failed");
    const pair = await app.request("http://127.0.0.1:3001/api/clip/pair", {
      method: "POST",
      headers: { ...H, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(((await pair.json()) as { error?: string }).error ?? "").not.toBe("Authentication failed");
  });

  it("(g) preflight の応答に Access-Control-Max-Age がある", async () => {
    const res = await createApp({ mode: "node" }).request("http://localhost/api/models", {
      method: "OPTIONS",
      headers: {
        Origin: "tauri://localhost",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "x-graphium-token",
      },
    });
    expect(res.headers.get("access-control-max-age")).toBe("600");
  });
});
