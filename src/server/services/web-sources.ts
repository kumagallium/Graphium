// チャット回答に付ける「web 出典」の抽出。
//
// web 検索には 2 経路ある:
//   A) Claude Code 内蔵 WebSearch（claude-subscription）— 検索が CLI 内で完結し、Graphium から
//      ツール呼び出しとしては見えない。出典はモデル出力の "Sources:" 見出しを note-app 側で
//      「🌐 Web の出典」にラベル置換して表示する（別経路）。
//   B) Tavily 等の検索 MCP — 検索ヒット（URL/タイトル）を「ツール結果」として返す。
//      本モジュールはその出力から URL を決定論的に拾い、回答末尾に「🌐 Web の出典」を
//      付けられるようにする。モデルの散文に出典が出ない B 経路の取りこぼしを埋める。

import type { ToolCallRecord } from "./agent-loop.js";

export type WebSource = { title?: string; url: string };

/** 回答に並べる web 出典の上限（ノイズ抑制）。 */
const MAX_WEB_SOURCES = 10;

// 検索系 MCP ツールかどうかをツール名で判定する。Notion 等の「ノート検索」を巻き込まないよう、
// web 検索に特有のキーワードに限定する（"notion-search" などはマッチさせない）。
const WEB_SEARCH_TOOL_RE =
  /tavily|brave|exa|serpapi|serp|perplexity|duckduckgo|kagi|web[_-]?search|search[_-]?web/i;

export function isWebSearchTool(toolName: string): boolean {
  return WEB_SEARCH_TOOL_RE.test(toolName);
}

// 文字列中の URL を雑に拾うための正規表現。末尾の句読点・閉じ括弧は除去する。
const URL_RE = /https?:\/\/[^\s"'<>)\]}]+/g;

function pushUrl(raw: string, out: WebSource[], seen: Set<string>, title?: string): void {
  const url = raw.replace(/[.,;]+$/, "");
  if (!/^https?:\/\//.test(url) || seen.has(url)) return;
  seen.add(url);
  out.push(title ? { title, url } : { url });
}

/** 任意のツール出力（ネストした JSON / 文字列）から {title, url} を再帰的に集める。 */
function collectFromValue(value: unknown, out: WebSource[], seen: Set<string>): void {
  if (value == null || out.length >= MAX_WEB_SOURCES) return;

  if (typeof value === "string") {
    const matches = value.match(URL_RE);
    if (matches) for (const m of matches) pushUrl(m, out, seen);
    return;
  }

  if (Array.isArray(value)) {
    for (const v of value) collectFromValue(v, out, seen);
    return;
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const url = typeof obj.url === "string" ? obj.url
      : typeof obj.link === "string" ? obj.link
      : undefined;
    if (url && /^https?:\/\//.test(url)) {
      // url を持つ「検索ヒット」オブジェクトとして扱い、title を添えて 1 件登録する。
      // ここで return し、content など本文中の別 URL までは拾わない（過剰収集防止）。
      const title = typeof obj.title === "string" ? obj.title
        : typeof obj.name === "string" ? obj.name
        : undefined;
      pushUrl(url, out, seen, title);
      return;
    }
    for (const v of Object.values(obj)) collectFromValue(v, out, seen);
  }
}

/**
 * 検索系ツールの出力だけを対象に web 出典を抽出する（重複 URL は除去、最大 MAX_WEB_SOURCES 件）。
 * @param toolCalls runAgentLoop が返したツール呼び出し記録（input/output 込み）
 */
export function extractWebSources(toolCalls: ToolCallRecord[]): WebSource[] {
  const out: WebSource[] = [];
  const seen = new Set<string>();
  for (const tc of toolCalls) {
    if (!isWebSearchTool(tc.tool_name)) continue;
    collectFromValue(tc.output, out, seen);
    if (out.length >= MAX_WEB_SOURCES) break;
  }
  return out.slice(0, MAX_WEB_SOURCES);
}
