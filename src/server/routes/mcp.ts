// MCP サーバーの接続テスト API
//
// 設定画面で登録した MCP サーバーが「実際に使えるか」をユーザーが確かめるための口。
//
// 登録時に走る parseMcpServersJson は JSON の形しか見ないので、コマンドを打ち間違え
// ても登録は通ってしまう。従来はその失敗が AI チャットを使うまで分からず、しかも
// getMCPTools の graceful degradation で握りつぶされるため「ツールが出てこない」と
// しか見えなかった。ここを叩けば、繋がるか・何のツールが見えるかがその場で分かる。
//
// 検証範囲は MCP プロトコルの握手（initialize → tools/list）まで。プロトコルの規定
// なのでサーバーの中身に依存せず、stdio / SSE / streamable-http のどれでも、どんな
// MCP サーバーでも同じように効く。逆に「トークンのスコープが足りているか」「向き先の
// ワークスペースが正しいか」は繋がっても分からない — そこは実際にツールを呼ぶしかない。

import { Hono } from "hono";
import { testMCPServer, type MCPServerInfo } from "../services/mcp.js";

const app = new Hono();

/** リクエストボディを MCPServerInfo に正規化する。不正なら理由を返す */
function parseServer(raw: unknown): { server: MCPServerInfo } | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "server object is required" };
  const s = raw as Record<string, unknown>;
  const name = typeof s.name === "string" && s.name.trim() ? s.name.trim() : "";
  if (!name) return { error: "name is required" };
  // id はプールを使わないテストでは使わないが、型を満たすために名前で代用する
  const id = typeof s.id === "string" && s.id ? s.id : name;

  if (s.type === "stdio") {
    const command = typeof s.command === "string" ? s.command.trim() : "";
    if (!command) return { error: "command is required for stdio servers" };
    const args = Array.isArray(s.args) ? s.args.filter((a): a is string => typeof a === "string") : [];
    const env =
      s.env && typeof s.env === "object" && !Array.isArray(s.env)
        ? Object.fromEntries(
            Object.entries(s.env as Record<string, unknown>)
              .filter(([, v]) => typeof v === "string")
              .map(([k, v]) => [k, v as string]),
          )
        : undefined;
    return { server: { id, type: "stdio", name, command, args, env } };
  }

  if (s.type === "remote") {
    const url = typeof s.url === "string" ? s.url.trim() : "";
    if (!url) return { error: "url is required for remote servers" };
    const transport = s.transport === "streamable-http" ? "streamable-http" : "sse";
    const apiKey = typeof s.apiKey === "string" && s.apiKey.trim() ? s.apiKey.trim() : undefined;
    return { server: { id, type: "remote", name, url, transport, apiKey } };
  }

  return { error: 'type must be "stdio" or "remote"' };
}

/**
 * POST /api/mcp/test — 1 サーバーに接続してツール一覧が取れるかを確かめる。
 *
 * 接続できなかったこと自体は「テストの失敗」であってサーバーエラーではないので、
 * HTTP は 200 のまま body の ok で伝える。400 になるのはリクエストが壊れている場合だけ。
 */
app.post("/test", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const parsed = parseServer((body as Record<string, unknown>)?.server ?? body);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);

  const result = await testMCPServer(parsed.server);
  return c.json(result);
});

export default app;
