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
