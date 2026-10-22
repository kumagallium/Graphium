// 知見抽出（/ingest）に渡す「既存の知見一覧」を組み立てる
//
// 一覧は毎回システムプロンプトに丸ごと載るので、知見が増えるとそれだけでモデルの
// コンテキストを使い切る（2,375 件・約 12.6 万トークンで 131k のモデルが全件失敗した）。
// ここでは次の 3 つで一覧を小さく保つ:
//   1. 知見（claim）だけを載せる — 統合（merge）と内部の裏づけ（internalClaimId）の
//      対象は知見だけ。トピック・要約・atom は ingester の出力に使われない
//   2. id を短い番号（c1, c2, …）にする — UUID は 1 個 20 トークン前後かかる。
//      応答の番号は resolveExistingClaimRef で元の id に戻す
//   3. 入力の予算に収まる分だけ、本文と関係が深い順に載せる — 載せなかった件数は
//      応答で返し、取り込みのトーストに出す（黙って減らさない）

import { estimateTokens } from "../../lib/context-estimate.js";
import type { ExistingWikiInfo } from "./wiki-ingester.js";

/**
 * 1 回の知見抽出で送る入力（指示文 + 一覧 + 本文）の上限（estimateTokens の目安）。
 * estimateTokens は日本語を実測（o200k）の約 7 割に数えるので、目安 72,000 は実測で
 * 10 万前後になる。131,072 トークンのモデル（gpt-oss-120b など）でも出力の余白が残る値
 */
export const INGEST_INPUT_BUDGET_TOKENS = 72_000;

/** 本文が長くて予算が残らないときも、関係の深い知見をこれだけは載せる（目安トークン） */
export const MIN_EXISTING_INDEX_TOKENS = 2_000;

export type ExistingClaimIndex = {
  /** システムプロンプトの "Existing Wikis" 節にそのまま入れる一覧 */
  text: string;
  /** 一覧に載せた番号 → 元の id */
  refToId: Map<string, string>;
  /** 一覧に載せた知見の数 */
  shown: number;
  /** 予算に収まらず載せなかった知見の数 */
  omitted: number;
};

/** 2 文字ずつの並び（小文字化・空白を詰める）。和文は空白で区切れないので語ではなく文字で見る */
function bigrams(text: string): Set<string> {
  const s = text.toLowerCase().replace(/\s+/g, "");
  const out = new Set<string>();
  const chars = [...s];
  for (let i = 0; i + 1 < chars.length; i++) out.add(chars[i] + chars[i + 1]);
  return out;
}

/** 知見タイトルの並びのうち、本文にも出るものの割合（0..1） */
function relevance(title: string, source: Set<string>): number {
  const t = bigrams(title);
  if (t.size === 0) return 0;
  let hit = 0;
  for (const g of t) if (source.has(g)) hit++;
  return hit / t.size;
}

/**
 * 既存の知見一覧を組み立てる。
 *
 * @param existing クライアントが送った既存ナレッジ（全種類）
 * @param sourceText 関係の深さを測る本文（タイトル + 本文）
 * @param budgetTokens 一覧に使ってよい目安トークン（MIN_EXISTING_INDEX_TOKENS を下回らない）
 */
export function buildExistingClaimIndex(
  existing: ExistingWikiInfo[],
  sourceText: string,
  budgetTokens: number = Number.POSITIVE_INFINITY,
): ExistingClaimIndex {
  const claims = existing.filter((w) => w.kind === "claim" && w.id && w.title);
  const budget = Math.max(budgetTokens, MIN_EXISTING_INDEX_TOKENS);

  // 番号は送られてきた順で振る（並べ替えで番号が変わらないように）
  const numbered = claims.map((w, i) => ({ ref: `c${i + 1}`, id: w.id, title: w.title, order: i }));

  // 全部載るなら並べ替えない（送られてきた順のまま）
  const lines = numbered.map((w) => `- ${w.ref}: ${w.title}`);
  const totalTokens = estimateTokens(lines.join("\n"));
  let picked = numbered;
  if (totalTokens > budget) {
    const source = bigrams(sourceText);
    const ranked = numbered
      .map((w) => ({ ...w, score: relevance(w.title, source) }))
      .sort((a, b) => b.score - a.score || a.order - b.order);
    picked = [];
    let used = 0;
    for (const w of ranked) {
      const cost = estimateTokens(`- ${w.ref}: ${w.title}\n`);
      if (used + cost > budget) break;
      picked.push(w);
      used += cost;
    }
  }

  const refToId = new Map<string, string>();
  for (const w of picked) refToId.set(w.ref, w.id);
  return {
    text: picked.map((w) => `- ${w.ref}: ${w.title}`).join("\n"),
    refToId,
    shown: picked.length,
    omitted: claims.length - picked.length,
  };
}

/**
 * モデルが返した参照（c12 など）を元の id に戻す。元の id をそのまま返してきた場合も受ける。
 * どちらでもなければ undefined（一覧に無いものを統合先にしない）。
 */
export function resolveExistingClaimRef(raw: string | undefined, index: ExistingClaimIndex): string | undefined {
  if (!raw) return undefined;
  const key = raw.trim().replace(/^#/, "");
  const byRef = index.refToId.get(key) ?? index.refToId.get(key.toLowerCase());
  if (byRef) return byRef;
  for (const id of index.refToId.values()) if (id === key) return id;
  return undefined;
}
