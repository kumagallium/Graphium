// MCP クライアント管理
// 2 つの接続方式に対応する:
//   - remote : 起動済みサーバーへ HTTP/SSE で接続（Crucible Registry 由来もこれ）
//   - stdio  : ローカルでコマンドを子プロセスとして spawn（Claude Desktop と同じ方式）
//
// stdio / remote とも接続コスト（特に stdio の spawn + handshake）が高いので、
// サーバー id をキーにした永続プールでクライアントを使い回す。設定が変わると
// 署名が変わり、自動で旧クライアントを閉じて張り直す。

import { createMCPClient } from "@ai-sdk/mcp";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

/** プールのキーになる接続情報。id で同一サーバーを識別する */
export type MCPServerInfo =
  | {
      id: string;
      type: "remote";
      name: string;
      url: string;
      transport: "sse" | "streamable-http";
      /** 任意の認証トークン（Authorization: Bearer で送信） */
      apiKey?: string;
    }
  | {
      id: string;
      type: "stdio";
      name: string;
      command: string;
      args: string[];
      env?: Record<string, string>;
    };

type MCPClient = Awaited<ReturnType<typeof createMCPClient>>;

const CONNECTION_TIMEOUT_MS = 10_000;

// id → { 署名, 接続中/接続済みクライアント } の永続プール。
// 同じプロセス（Tauri sidecar / Docker / dev）が生きている限り使い回す。
type PoolEntry = { signature: string; clientPromise: Promise<MCPClient> };
const pool = new Map<string, PoolEntry>();

/** 接続情報の署名。接続に関わる全フィールドを含めるので、設定変更で必ず変わる */
function signatureOf(s: MCPServerInfo): string {
  return JSON.stringify(s);
}

/** クライアントを静かに閉じる（エラーは握りつぶす） */
function closeQuietly(p: Promise<MCPClient>): void {
  void p.then((c) => c.close()).catch(() => {});
}

/** 接続先の説明（ログ用） */
function describe(s: MCPServerInfo): string {
  return s.type === "stdio" ? `${s.command} ${s.args.join(" ")}`.trim() : s.url;
}

/** 1 サーバーに接続して MCP クライアントを生成する（タイムアウト付き） */
function connectWithTimeout(s: MCPServerInfo): Promise<MCPClient> {
  const build = async (): Promise<MCPClient> => {
    if (s.type === "stdio") {
      // getDefaultEnvironment() は PATH 等の安全な既定環境を返す。
      // npx / uvx を解決するために必須。ユーザー指定の env で上書きする。
      const transport = new StdioClientTransport({
        command: s.command,
        args: s.args,
        env: { ...getDefaultEnvironment(), ...(s.env ?? {}) },
      });
      return createMCPClient({ transport });
    }
    const headers = s.apiKey ? { Authorization: `Bearer ${s.apiKey}` } : undefined;
    const transport =
      s.transport === "streamable-http"
        ? { type: "http" as const, url: s.url, headers }
        : { type: "sse" as const, url: s.url, headers };
    return createMCPClient({ transport });
  };
  return Promise.race([
    build(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Connection timeout")), CONNECTION_TIMEOUT_MS),
    ),
  ]);
}

/** プールからクライアントを取得（無ければ接続）。署名が変わっていたら張り直す */
function getOrConnect(s: MCPServerInfo): Promise<MCPClient> {
  const sig = signatureOf(s);
  const existing = pool.get(s.id);
  if (existing && existing.signature !== sig) {
    closeQuietly(existing.clientPromise);
    pool.delete(s.id);
  }
  let entry = pool.get(s.id);
  if (!entry) {
    entry = { signature: sig, clientPromise: connectWithTimeout(s) };
    pool.set(s.id, entry);
  }
  return entry.clientPromise;
}

/**
 * 指定サーバー群のツールを取得する。
 * 接続は永続プールで使い回し、接続失敗したサーバーはスキップする（graceful degradation）。
 * 死んだクライアントは破棄して 1 度だけ再接続を試みる。
 */
export async function getMCPTools(
  servers: MCPServerInfo[],
): Promise<{ tools: Record<string, unknown> }> {
  let tools: Record<string, unknown> = {};

  const results = await Promise.allSettled(
    servers.map(async (server) => {
      try {
        const client = await getOrConnect(server);
        try {
          const serverTools = await client.tools();
          return { tools: serverTools, name: server.name };
        } catch {
          // ツール取得に失敗 = クライアントが死んでいる可能性。破棄して 1 度だけ張り直す。
          closeQuietly(Promise.resolve(client));
          pool.delete(server.id);
          const retry = await getOrConnect(server);
          const serverTools = await retry.tools();
          return { tools: serverTools, name: server.name };
        }
      } catch (err) {
        pool.delete(server.id);
        throw new Error(`${server.name} (${describe(server)}): ${err instanceof Error ? err.message : err}`);
      }
    }),
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      tools = { ...tools, ...result.value.tools };
    } else {
      console.warn(`MCP 接続失敗: ${result.reason}`);
    }
  }

  return { tools };
}

/**
 * プール内のすべての MCP クライアントを閉じる（プロセス終了時など）。
 */
export async function closeAllMCPClients(): Promise<void> {
  const entries = [...pool.values()];
  pool.clear();
  await Promise.allSettled(entries.map((e) => e.clientPromise.then((c) => c.close())));
}
