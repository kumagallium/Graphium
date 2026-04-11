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

/**
 * Crucible Registry に登録された全サーバー/ツールを取得する
 */
export async function fetchRegistryServers(
  registryUrl: string,
  apiKey?: string,
): Promise<RegistryServer[]> {
  if (!registryUrl) return [];

  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers["X-API-Key"] = apiKey;

    const res = await fetch(`${registryUrl.replace(/\/$/, "")}/api/servers`, {
      headers,
    });
    if (!res.ok) return [];

    // Registry は配列を直接返す
    const data = await res.json() as RegistryServer[] | { servers?: RegistryServer[] };
    const servers: RegistryServer[] = Array.isArray(data) ? data : (data.servers ?? []);
    return servers;
  } catch {
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
 * MCP サーバーの SSE URL を構築する
 */
export function buildSSEUrl(server: RegistryServer, registryUrl: string): string {
  // Registry と同じホスト上で port と endpoint_path から URL を構築
  const host = new URL(registryUrl).hostname;
  const port = server.port ?? 8100;
  const path = server.endpoint_path ?? "/sse";
  return `http://${host}:${port}${path}`;
}
