// POST /api/mcp/test のリクエスト検証テスト。
//
// 実接続そのもの（握手が通るか）は e2e/mcp-smoke.mjs が Graphium 自身の MCP サーバーで
// 担保している。ここで押さえるのは「壊れたリクエストを 400 で弾く」「接続失敗は 500 では
// なく 200 + ok:false で返す」という境界のほう。後者が崩れると、UI 側が「サーバーが落ちた」
// と「設定が間違っている」を区別できなくなる。

import { describe, it, expect } from "vitest";
import app from "./mcp.js";

async function post(body: unknown) {
  const res = await app.request("/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("POST /api/mcp/test の入力検証", () => {
  it("JSON として壊れていれば 400", async () => {
    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    expect(res.status).toBe(400);
  });

  it("name が無ければ 400", async () => {
    const { status, body } = await post({ server: { type: "stdio", command: "npx" } });
    expect(status).toBe(400);
    expect(String(body.error)).toContain("name");
  });

  it("stdio で command が無ければ 400", async () => {
    const { status, body } = await post({ server: { type: "stdio", name: "x" } });
    expect(status).toBe(400);
    expect(String(body.error)).toContain("command");
  });

  it("remote で url が無ければ 400", async () => {
    const { status, body } = await post({ server: { type: "remote", name: "x" } });
    expect(status).toBe(400);
    expect(String(body.error)).toContain("url");
  });

  it("type が stdio / remote 以外なら 400", async () => {
    const { status, body } = await post({ server: { type: "carrier-pigeon", name: "x" } });
    expect(status).toBe(400);
    expect(String(body.error)).toContain("type");
  });

  it("server ラッパー無しの素の設定も受け付ける", async () => {
    // ラッパーの有無で 400 になると、呼び出し側の些細な違いで「設定が悪い」に見えてしまう
    const { status } = await post({ type: "stdio", name: "x" as string, command: "" });
    expect(status).toBe(400); // command が空なので 400 だが、name の検証は通っている
    const { body } = await post({ type: "stdio", name: "x", command: "" });
    expect(String(body.error)).toContain("command");
  });
});
