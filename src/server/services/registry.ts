// Crucible Registry からのサーバー・ツール自動検出

export type RegistryServer = {
  name: string;
  display_name: string;
  description?: string;
  tool_type: string;
  status: string;
  port?: number;
  endpoint_path?: string;
  icon?: string;
  content?: string; // Skill のマークダウン本文
};

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * 環境変数の CRUCIBLE_API_KEY を付けてよい宛先か。
 * 環境変数の CRUCIBLE_API_URL と同じオリジンのときだけ。X-Registry-URL で別の宛先を
 * 指された要求には、環境変数の鍵を付けない（宛先を差し替えて鍵を持ち出されないように）。
 */
export function mayUseEnvRegistryKey(registryUrl: string): boolean {
  const target = originOf(registryUrl);
  const configured = originOf(process.env.CRUCIBLE_API_URL);
  return target !== null && target === configured;
}

/**
 * Crucible Registry に登録された全サーバー/ツールを取得する
 *
 * apiKey が環境変数の CRUCIBLE_API_KEY と同じ値のとき、宛先が CRUCIBLE_API_URL と
 * 別オリジンなら鍵を付けない（呼び出し側が環境変数の鍵を無条件に渡しても漏らさない）。
 * 利用者が X-Registry-Key で明示した鍵（環境変数と別の値）はそのまま使う。
 * リダイレクトは辿らない（鍵をリダイレクト先へ渡さない）。
 */
export async function fetchRegistryServers(
  registryUrl: string,
  apiKey?: string,
): Promise<RegistryServer[]> {
  if (!registryUrl) return [];

  try {
    const headers: Record<string, string> = {};
    const envKey = process.env.CRUCIBLE_API_KEY || "";
    const keyIsFromEnv = !!apiKey && apiKey === envKey;
    if (apiKey && (!keyIsFromEnv || mayUseEnvRegistryKey(registryUrl))) {
      headers["X-API-Key"] = apiKey;
    }

    const res = await fetch(`${registryUrl.replace(/\/$/, "")}/api/servers`, {
      headers,
      redirect: "error",
    });
    if (!res.ok) return [];

    // Registry は配列を直接返す
    const data = await res.json() as RegistryServer[] | { servers?: RegistryServer[] };
    const servers: RegistryServer[] = Array.isArray(data) ? data : (data.servers ?? []);
    return servers;
  } catch (err) {
    // リダイレクトで落ちたときだけ原因が分かるよう 1 行出す（鍵や URL のクエリは出さない）
    // undici は TypeError("fetch failed") の cause に "unexpected redirect" を入れる
    const cause = (err as { cause?: unknown } | null)?.cause;
    if (/redirect/i.test(`${String(err)} ${String(cause ?? "")}`)) {
      console.warn(
        "[registry] Registry returned a redirect, which is not followed. Set CRUCIBLE_API_URL to the final URL.",
      );
    }
    // Registry に接続できない場合はツールなしで動作する
    return [];
  }
}

/**
 * MCP サーバー（SSE 接続可能なもの）のみフィルタする
 */
export function filterMCPServers(servers: RegistryServer[]): RegistryServer[] {
  return servers.filter(
    (s) => s.tool_type === "mcp_server" && s.status === "running",
  );
}

/**
 * Skill（マークダウン）のみフィルタする
 */
export function filterSkills(servers: RegistryServer[]): RegistryServer[] {
  return servers.filter(
    (s) => s.tool_type === "skill" && s.content?.trim(),
  );
}

/**
 * Skill のマークダウンをシステムプロンプトに注入するセクションを構築する
 * Crucible Agent 互換: 1 skill あたり 3000 文字、全体 10000 文字上限
 */
export function buildSkillPromptSection(skills: RegistryServer[]): string {
  if (skills.length === 0) return "";

  const SKILL_MAX_CHARS = 3000;
  const TOTAL_MAX_CHARS = 10000;

  const sections: string[] = [];
  let total = 0;
  for (const s of skills) {
    const content = (s.content ?? "").slice(0, SKILL_MAX_CHARS);
    if (total + content.length > TOTAL_MAX_CHARS) break;
    sections.push(`### ${s.display_name}\n\n${content}`);
    total += content.length;
  }

  return "\n\n## Available Skills\n\n" + sections.join("\n\n---\n\n");
}

/**
 * MCP サーバーの接続 URL を構築する
 */
export function buildMCPUrl(server: RegistryServer, registryUrl: string): string {
  const host = new URL(registryUrl).hostname;
  const port = server.port ?? 8100;
  const path = server.endpoint_path ?? "/sse";
  return `http://${host}:${port}${path}`;
}

/**
 * エンドポイントパスからトランスポートタイプを判定する
 * /mcp → Streamable HTTP、/sse → SSE
 */
export function detectTransport(server: RegistryServer): "sse" | "streamable-http" {
  const path = server.endpoint_path ?? "/sse";
  return path.includes("/mcp") ? "streamable-http" : "sse";
}
