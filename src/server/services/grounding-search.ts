// World-model grounding 用の検索ブリッジ（Phase 5 前倒し / web-grounding）。
//
// 世界照合の判定前に、接続済み MCP サーバーの「検索ツール」をプログラムから
// 直接 1 回実行し、その結果（証拠テキスト + 実在 URL 集合）を取り出す。
//
// 設計判断（議論で合意済み）:
//  - pre-retrieval 方式: モデルにツールを叩かせず、こちらが 1 回検索して証拠を注入する。
//    → 単発 JSON 契約を維持し、コストを固定し、URL ガードレールを自明にする。
//  - whitelist → provenance: 「ドメインが安全か」ではなく「検索が実際に返した URL か」で
//    出力 URL を絞る。取得集合に属することが、ドメイン制限より強い実在保証になる。
//
// この module は MCP の接続詳細に依存しない leaf util。ツールは AI SDK の
// `client.tools()` が返す形（execute を持つ）だけを前提にする。

/** AI SDK ツールの最小形。MCP 由来ツールはこの形で `execute` を持つ。 */
export type GroundingSearchTool = {
  execute: (args: Record<string, unknown>, options: unknown) => Promise<unknown>;
  inputSchema?: unknown;
  parameters?: unknown;
};

/** ツール名から「検索ツール」を見分ける正規表現。 */
// 明確に web 検索とわかる名前を最優先する（fetch 系=URL 取得は claim 検索に使えないので避ける）。
const PREFER_SEARCH_RE =
  /(web[_\- ]?search|search[_\- ]?web|tavily|exa|brave|serp|duckduckgo|ddg|google[_\- ]?search)/i;
// 一般的な検索系の名前（後段のフォールバック）。
const SEARCH_TOOL_RE =
  /(^search$|_search$|^search_|web[_\- ]?query|find[_\- ]?sources?|knowledge[_\- ]?search)/i;

/**
 * 接続済みツール群から検索ツールを 1 つ選ぶ。
 * web 検索とわかる名前を優先し、無ければ一般的な検索名にフォールバックする。
 * execute を持たないツールは除外する。見つからなければ null。
 */
export function findSearchTool(
  tools: Record<string, unknown>,
): { name: string; tool: GroundingSearchTool } | null {
  const entries = Object.entries(tools).filter(
    ([, t]) => t && typeof (t as { execute?: unknown }).execute === "function",
  );
  let hit = entries.find(([name]) => PREFER_SEARCH_RE.test(name));
  if (!hit) hit = entries.find(([name]) => SEARCH_TOOL_RE.test(name));
  if (!hit) return null;
  return { name: hit[0], tool: hit[1] as GroundingSearchTool };
}

/**
 * 検索ツールの入力スキーマを覗いて、クエリ文字列を流し込むパラメータ名を推定する。
 * MCP サーバーごとに query / q / input など名前が違うため、よくある名前 → 最初の
 * string プロパティ → 最初のプロパティ、の順に探す。判別できなければ "query"。
 */
export function pickQueryParam(tool: GroundingSearchTool): string {
  const t = tool as Record<string, any>;
  const schema =
    t?.inputSchema?.jsonSchema ??
    t?.parameters?.jsonSchema ??
    t?.inputSchema ??
    t?.parameters;
  const props = schema?.properties;
  if (props && typeof props === "object") {
    const keys = Object.keys(props);
    const preferred = [
      "query",
      "q",
      "search",
      "searchQuery",
      "search_query",
      "keyword",
      "keywords",
      "term",
      "text",
      "input",
      "prompt",
    ];
    for (const p of preferred) if (keys.includes(p)) return p;
    for (const k of keys) {
      const ty = props[k]?.type;
      if (ty === "string" || (Array.isArray(ty) && ty.includes("string"))) return k;
    }
    if (keys.length > 0) return keys[0];
  }
  return "query";
}

// URL 抽出: 空白・引用符・閉じ括弧類で区切る。Wikipedia の `(planet)` を壊さないよう
// `(` `)` は許容し、後段で末尾の不均衡な `)` だけ落とす。
const URL_RE = /https?:\/\/[^\s"'<>\]}\\]+/gi;

function trimUrl(u: string): string {
  let url = u.replace(/[.,;:!?'"]+$/, "");
  // 散文中の `(... https://example.com)` のような末尾 `)` は落とす。
  // ただし `(planet)` 型（`(` を含む）は残す。
  if (url.endsWith(")") && !url.includes("(")) url = url.slice(0, -1);
  return url;
}

/**
 * URL を照合用に正規化する。出力 URL が「証拠に出てきた URL か」を判定するキー。
 * - http(s) 以外は null（捨てる）
 * - hash 除去・ホスト小文字化・末尾スラッシュ除去（query は残す）
 */
export function normalizeUrlForMatch(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    let s = `${u.protocol}//${u.host.toLowerCase()}${u.pathname}`.replace(/\/+$/, "");
    if (u.search) s += u.search;
    return s;
  } catch {
    return null;
  }
}

/** テキストから http(s) URL を重複なく抽出する（上限 cap 件）。 */
export function extractUrls(text: string, cap = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.match(URL_RE) ?? []) {
    const url = trimUrl(raw);
    const norm = normalizeUrlForMatch(url);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(url);
    if (out.length >= cap) break;
  }
  return out;
}

/** MCP ツール結果（CallToolResult / 文字列 / 任意オブジェクト）をテキストに落とす。 */
export function renderToolResultText(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "object") {
    const obj = raw as Record<string, any>;
    // MCP CallToolResult: { content: [{ type: "text", text }, ...] }
    if (Array.isArray(obj.content)) {
      const parts = obj.content
        .map((p: any) => {
          if (typeof p === "string") return p;
          if (p && typeof p === "object") {
            if (typeof p.text === "string") return p.text;
            if (p.type === "resource" && typeof p.resource?.text === "string")
              return p.resource.text;
          }
          return "";
        })
        .filter((s: string) => s.length > 0);
      if (parts.length > 0) return parts.join("\n");
    }
    try {
      return JSON.stringify(obj);
    } catch {
      return String(obj);
    }
  }
  return String(raw);
}

/** 検索実行のタイムアウト（ms）。MCP ツールがハングしても世界照合を巻き込まない。 */
const SEARCH_TIMEOUT_MS = 15_000;

export type GroundingSearchOutcome = {
  /** 判定プロンプトに注入する証拠テキスト（切り詰め済み） */
  evidenceText: string;
  /** 証拠に出現した実在 URL（出力 URL の許可集合のもと） */
  urls: string[];
};

/**
 * 検索ツールを 1 回実行し、証拠テキストと URL 集合を返す。
 * 失敗・タイムアウト・空結果は { evidenceText: "", urls: [] } に倒す
 * （呼び出し側は parametric 判定にフォールバックする）。
 */
export async function runGroundingSearch(
  entry: { name: string; tool: GroundingSearchTool },
  query: string,
  opts: { maxChars?: number; maxUrls?: number } = {},
): Promise<GroundingSearchOutcome> {
  const maxChars = opts.maxChars ?? 4000;
  const maxUrls = opts.maxUrls ?? 12;
  const param = pickQueryParam(entry.tool);
  const args: Record<string, unknown> = { [param]: query };

  let raw: unknown;
  try {
    raw = await Promise.race([
      entry.tool.execute(args, {
        toolCallId: "world-grounding-search",
        messages: [],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("search timeout")), SEARCH_TIMEOUT_MS),
      ),
    ]);
  } catch (err) {
    console.warn(
      `[world-grounding] search tool "${entry.name}" failed:`,
      err instanceof Error ? err.message : err,
    );
    return { evidenceText: "", urls: [] };
  }

  let text = renderToolResultText(raw).trim();
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n…(truncated)`;
  const urls = extractUrls(text, maxUrls);
  return { evidenceText: text, urls };
}
