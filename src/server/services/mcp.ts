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

/** 接続に失敗した 1 サーバー。呼び出し側が UI に出せるよう構造化して返す */
export type MCPConnectionFailure = { name: string; target: string; message: string };

/** Promise.allSettled の reason にサーバー名を載せて運ぶための内部エラー */
class MCPConnectionError extends Error {
  readonly serverName: string;
  readonly target: string;
  readonly detail: string;
  constructor(server: MCPServerInfo, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`${server.name} (${describe(server)}): ${detail}`);
    this.name = "MCPConnectionError";
    this.serverName = server.name;
    this.target = describe(server);
    this.detail = detail;
  }
}

/**
 * 指定サーバー群のツールを取得する。
 * 接続は永続プールで使い回し、接続失敗したサーバーはスキップする（graceful degradation）。
 * 死んだクライアントは破棄して 1 度だけ再接続を試みる。
 *
 * 失敗は errors に載せて返す。以前は console.warn で握りつぶしていたため、設定を
 * 間違えたユーザーには「ツールが出てこない」ようにしか見えず、原因に辿り着けなかった。
 * ツールが 1 つも取れなくても throw はしない（動くサーバーだけで続行する方針は維持）。
 */
export async function getMCPTools(
  servers: MCPServerInfo[],
): Promise<{ tools: Record<string, unknown>; errors: MCPConnectionFailure[] }> {
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
        throw new MCPConnectionError(server, err);
      }
    }),
  );

  const errors: MCPConnectionFailure[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      tools = { ...tools, ...result.value.tools };
    } else {
      const reason: unknown = result.reason;
      const failure: MCPConnectionFailure =
        reason instanceof MCPConnectionError
          ? { name: reason.serverName, target: reason.target, message: reason.detail }
          : { name: "", target: "", message: reason instanceof Error ? reason.message : String(reason) };
      errors.push(failure);
      console.warn(`MCP 接続失敗: ${failure.name} (${failure.target}): ${failure.message}`);
    }
  }

  return { tools, errors };
}

export type MCPTestResult =
  | { ok: true; tools: string[] }
  | { ok: false; error: string };

/**
 * 1 サーバーの設定が実際に使えるかを確かめる（設定画面の「接続テスト」用）。
 *
 * プールは使わず毎回新しく繋いで、終わったら閉じる。プールを使うと「設定を直した
 * のに古い接続が生きていて成功に見える」「壊れた接続が残って失敗に見える」が起こり、
 * テストとして信用できないため。
 *
 * 検証しているのは MCP プロトコルの握手（initialize → tools/list）だけなので、
 * stdio / SSE / streamable-http のどれでも、どのサーバーでも同じように効く。
 * 逆に「トークンのスコープが足りているか」「向き先が正しいワークスペースか」は
 * ここでは判定できない — 接続できてツールが見えるところまでが保証範囲。
 */
export async function testMCPServer(server: MCPServerInfo): Promise<MCPTestResult> {
  let client: MCPClient | undefined;
  try {
    client = await connectWithTimeout(server);
    const tools = await client.tools();
    return { ok: true, tools: Object.keys(tools) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    if (client) closeQuietly(Promise.resolve(client));
  }
}

/**
 * プール内のすべての MCP クライアントを閉じる（プロセス終了時など）。
 */
export async function closeAllMCPClients(): Promise<void> {
  const entries = [...pool.values()];
  pool.clear();
  await Promise.allSettled(entries.map((e) => e.clientPromise.then((c) => c.close())));
}
