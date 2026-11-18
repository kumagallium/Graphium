// X-MCP-Servers ヘッダーの値を作る。AI チャットと世界照合で形（id・type・name・url ほか）を揃える。

import { toAsciiJson } from "../../lib/ascii-json";
import { curatedApprovalFreeToolsForUrl } from "./mcp-connect/catalog";
import type { McpServerEntry } from "./store";

/** チャット用: 有効な全サーバー（stdio 含む）を、確認の免除の印つきで送る形にする */
export function chatMcpServerPayload(s: McpServerEntry): Record<string, unknown> {
  return {
    ...(s.type === "stdio"
      ? { id: s.id, type: "stdio", name: s.name, command: s.command, args: s.args, ...(s.env ? { env: s.env } : {}) }
      : remoteMcpServerPayload(s)),
    ...(s.skipApproval ? { skipApproval: true } : {}),
    ...(s.approvalFreeTools?.length ? { approvalFreeTools: s.approvalFreeTools } : {}),
  };
}

/** remote サーバーの接続情報だけ（免除の印は含まない） */
function remoteMcpServerPayload(s: Extract<McpServerEntry, { type: "remote" }>): Record<string, unknown> {
  return {
    id: s.id,
    type: "remote",
    name: s.name,
    url: s.url,
    transport: s.transport,
    ...(s.apiKey ? { apiKey: s.apiKey } : {}),
    ...(s.headers ? { headers: s.headers } : {}),
  };
}

/** チャット用ヘッダー値。サーバーが無ければ null */
export function buildChatMcpHeaderValue(servers: readonly McpServerEntry[]): string | null {
  if (servers.length === 0) return null;
  return toAsciiJson(servers.map(chatMcpServerPayload));
}

/**
 * 世界照合用ヘッダー値。厳選一覧に URL が当たる有効な remote のうち、「確認なしの道具」が一覧と共通するものだけを送る。
 * stdio は起動を伴うので送らない。skipApproval は載せない（サーバー丸ごと免除にならないように）。
 * 該当が無ければ null（ヘッダー自体を付けない）
 */
export function buildGroundingMcpHeaderValue(servers: readonly McpServerEntry[]): string | null {
  const picked: Record<string, unknown>[] = [];
  for (const s of servers) {
    if (!s.enabled || s.type !== "remote" || s.url.trim() === "") continue;
    // 保存値（localStorage）は信用せず、URL が厳選一覧に当たるサーバーだけを送る。
    // 送る道具名も一覧の定義との共通部分だけにする（任意 URL・一覧外の名前は送らない）
    const curated = curatedApprovalFreeToolsForUrl(s.url);
    if (!curated) continue;
    const tools = (s.approvalFreeTools ?? []).filter((t) => curated.includes(t));
    if (tools.length === 0) continue;
    picked.push({ ...remoteMcpServerPayload(s), approvalFreeTools: tools });
  }
  if (picked.length === 0) return null;
  return toAsciiJson(picked);
}
