// external（外部参照）スコープの実行手段 = Web 検索が使える構成かの client 側判定。
//
// external は Web 検索を「強制」するが、実際に検索できる経路はユーザーが登録した
// 検索系 MCP サーバー（Tavily 等）のツールだけ。
// 無い構成で external を選んでもエラーにはならず、「検索なしの回答」に
// 静かに劣化する（サーバー側は system prompt の graceful degradation 指示のみ —
// agent.ts の EXTERNAL_GROUNDING_INSTRUCTION）。選択の瞬間に気づけるよう、
// この hook が「検索手段が見当たらない」ことを heuristic で検知して警告に使う。
//
// 判定は断定ではない: MCP はサーバー登録名・コマンドからの推測で、実際のツール名は
// 接続時まで分からない。誤警告を避けるため、迷ったら "unknown"（何も出さない）に倒す。
// チャットパネルと Cmd+K Composer の双方から使う（GroundingScopeChip の付属品）。

import { useEffect, useState } from "react";
import { fetchModels } from "../ai-assistant/api";
import {
  getEnabledMcpServers,
  getSelectedModel,
  getDefaultLLMModel,
} from "../settings/store";
import { isTauri } from "../../lib/platform";

export type WebSearchAvailability = "available" | "missing" | "unknown";

// 検索系 MCP サーバーを名前・コマンド・URL から見分ける正規表現。
// サーバー側 grounding-search.ts の PREFER_SEARCH_RE と同系統（あちらはツール名、
// こちらは登録名向け）。「search」を広く拾うのは安全側 — 誤りは「検索できるのに
// 警告が出る」ではなく「警告を出さない」方向に倒れる。
const SEARCH_MCP_RE =
  /(search|tavily|exa|brave|serp|duckduckgo|ddg|perplexity|kagi)/i;

/** 有効な MCP サーバーに検索系らしきものが 1 つでもあるか（localStorage 同期読み）。 */
export function hasSearchCapableMcpServer(): boolean {
  return getEnabledMcpServers().some((s) => {
    const haystack =
      s.type === "stdio"
        ? [s.name, s.command, ...(s.args ?? [])].join(" ")
        : [s.name, s.url].join(" ");
    return SEARCH_MCP_RE.test(haystack);
  });
}

/**
 * チャットで実際に使われるモデルの provider を解決する。
 * チャット送信は body.options.model = getSelectedModel()（空 = サーバー default）なので
 * その解決順を再現する。desktop はサーバー models.json が唯一のレジストリ
 * （localStorage は空）のため /models API で引く。web は localStorage が実体。
 * モデルが 1 件も無い・API 不達なら null（= 判定不能）。
 */
async function resolveChatModelProvider(): Promise<string | null> {
  if (!isTauri()) {
    const local = getDefaultLLMModel();
    if (local) return local.provider;
    // web でも localStorage が空ならサーバー models.json に倒す（セルフホスト構成）
  }
  const res = await fetchModels();
  if (res.models.length === 0) return null;
  const name = getSelectedModel();
  const model =
    (name && res.models.find((m) => m.name === name)) ||
    (res.default && res.models.find((m) => m.name === res.default)) ||
    res.models[0];
  return model?.provider ?? null;
}

/**
 * Web 検索手段の有無を判定する。`active` が false（external 以外を選択中）の間は
 * 何もせず "unknown" を返す。判定順:
 *   1. 検索系 MCP サーバーあり → "available"（同期・fetch 不要）
 *   2. チャットモデルの provider が判定できない（モデル 0 件・API 不達）→ "unknown"
 *      （AI 未設定は既存の no-models バナー領域なので二重警告しない）
 *   3. それ以外 → "missing"
 * external に入り直すたびに再評価するので、設定で MCP を追加して戻れば消える。
 */
export function useWebSearchAvailability(active: boolean): WebSearchAvailability {
  const [modelVerdict, setModelVerdict] = useState<WebSearchAvailability>("unknown");
  // MCP・選択モデル名は localStorage の同期読みなので毎レンダ評価する。警告の
  // 「設定を開く」から MCP 追加やモデル切り替えをして戻ると、設定モーダル close に
  // 伴う再レンダでここが変わり、警告が即追従する（イベント購読なしで主要導線を拾う）。
  const mcpAvailable = active && hasSearchCapableMcpServer();
  const selectedModelName = active ? getSelectedModel() : "";
  useEffect(() => {
    if (!active || mcpAvailable) return;
    let cancelled = false;
    (async () => {
      try {
        const provider = await resolveChatModelProvider();
        if (cancelled) return;
        setModelVerdict(provider === null ? "unknown" : "missing");
      } catch {
        if (!cancelled) setModelVerdict("unknown");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, mcpAvailable, selectedModelName]);
  if (!active) return "unknown";
  return mcpAvailable ? "available" : modelVerdict;
}
