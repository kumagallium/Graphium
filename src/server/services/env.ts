// 環境設定のヘルパー
// リクエストヘッダー → 環境変数の優先順で値を取得する

import type { Context } from "hono";

/**
 * Crucible Registry URL を取得する
 * 優先順: X-Registry-URL ヘッダー → CRUCIBLE_API_URL 環境変数
 */
export function getRegistryUrl(c: Context): string {
  return c.req.header("X-Registry-URL") || process.env.CRUCIBLE_API_URL || "";
}

/**
 * Crucible Registry API Key を取得する
 */
export function getRegistryKey(): string {
  return process.env.CRUCIBLE_API_KEY || "";
}

/**
 * ユーザーが直接登録した MCP サーバー（Crucible 非依存の接続経路）。
 * フロントエンドが X-MCP-Servers ヘッダーに JSON 配列で送る。
 * stdio（ローカル spawn）か remote（HTTP/SSE）のいずれか。
 */
export type ManualMcpServer =
  | {
      id: string;
      type: "stdio";
      name: string;
      command: string;
      args: string[];
      env?: Record<string, string>;
    }
  | {
      id: string;
      type: "remote";
      name: string;
      url: string;
      transport: "sse" | "streamable-http";
      apiKey?: string;
    };

/**
 * X-MCP-Servers ヘッダーをパースして手動登録 MCP サーバー一覧を取得する。
 * 不正な JSON / 必須フィールド欠落エントリは無視する（graceful degradation）。
 */
export function getManualMcpServers(c: Context): ManualMcpServer[] {
  const raw = c.req.header("X-MCP-Servers");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: ManualMcpServer[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const s = item as Record<string, unknown>;
      const name = typeof s.name === "string" ? s.name : "";
      const id = typeof s.id === "string" && s.id ? s.id : name;
      if (!name) continue;

      if (s.type === "stdio") {
        if (typeof s.command !== "string" || !s.command.trim()) continue;
        const args = Array.isArray(s.args) ? s.args.filter((a): a is string => typeof a === "string") : [];
        const env =
          s.env && typeof s.env === "object" && !Array.isArray(s.env)
            ? (Object.fromEntries(
                Object.entries(s.env as Record<string, unknown>).filter(
                  (e): e is [string, string] => typeof e[1] === "string",
                ),
              ) as Record<string, string>)
            : undefined;
        out.push({ id, type: "stdio", name, command: s.command, args, env });
        continue;
      }

      // remote（type 未指定の旧形式もここで吸収）
      if (typeof s.url !== "string" || !s.url.trim()) continue;
      out.push({
        id,
        type: "remote",
        name,
        url: s.url,
        transport: s.transport === "streamable-http" ? "streamable-http" : "sse",
        apiKey: typeof s.apiKey === "string" && s.apiKey ? s.apiKey : undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}
