// ノートに紐づかないチャットで、AI が答えに使ったページを全体グラフのノードに直す。
//
// チャットの横に並べた全体グラフで「この会話で AI がどこを通ったか」を灯すために使う。
// 答えの本文に残った引用（[Source: "題名"]。normalizeWikiCitations が揃えたもの）を拾い、
// 題名 → 参照（retriever の getSourceTitleToRefMap）→ グラフのノード ID と引く。
// 参照が引けない題名（開き直した古い会話など）は、グラフのノードの題名で引き直す。
//
// 重み: いちばん新しい答えで使ったページは 1（ここだけ火花が走る。graph-firing の once）、
// それより前の答えで使ったページは EARLIER_WEIGHT（薄く灯るだけ）。
// 保存形式は変えない（会話の本文から毎回読み直す）。
//
// 全体グラフに点の無いページ（要約・素材）は、グラフの standIns で元のノートや出典の点に寄せる。
// 寄せる先も無いページは灯せないので、「グラフに無い」として数だけ見出しに出す（unplottedPages）。

import type { ChatMessage } from "../../lib/document-types";
import { toUsageRef } from "../ai-usage/usage-log";
import { usageRefToGraphId } from "../ai-usage/usage-activity";

/** グラフに点の無いページ → 代わりに示す点（NoteGraphData.standIns） */
export type StandIns = ReadonlyMap<string, readonly string[]>;

/** グラフの ID を、点のある ID に直す。点が無ければ代わりの点、それも無ければ空 */
export function toPlottedIds(id: string, nodeIds: ReadonlySet<string>, standIns?: StandIns): readonly string[] {
  if (nodeIds.has(id)) return [id];
  return standIns?.get(id) ?? [];
}

/** 参照（`wiki:` / `note:` / `asset:`）を、点のある ID に直す */
function refToPlottedIds(ref: string, nodeIds: ReadonlySet<string>, standIns?: StandIns): readonly string[] {
  const id = usageRefToGraphId(ref);
  return id ? toPlottedIds(id, nodeIds, standIns) : [];
}

/** 前の答えで使ったページの重み（中くらいの緑で残すだけ。読んだだけのページより濃く） */
export const EARLIER_WEIGHT = 0.5;

const SOURCE_RE = /\[Source:\s*"([^"\n]+)"\]/g;

/** 本文に出てくる引用の題名（出てきた順・重複なし） */
export function citedTitles(content: string): string[] {
  const out: string[] = [];
  for (const m of content.matchAll(SOURCE_RE)) {
    const title = m[1].trim();
    if (title && !out.includes(title)) out.push(title);
  }
  return out;
}

/**
 * 会話から、グラフのノード ID → 重み（0〜1）を作る。
 * - titleToRef: retriever の題名 → 参照（未指定なら題名だけで引く）
 * - nodes: いま全体グラフにあるノード（ID と題名）。ここに無いノードは返さない
 * - standIns: 点の無いページ（要約・素材）→ 代わりの点。引用されたら代わりの点を灯す
 * - standInByTitle: 参照が引けない引用の題名から standIns のキーを引く
 * 返す Map は「いちばん新しい答えのページ」が先に並ぶ（once の発火順）。
 */
export function chatUsedPageWeights(
  messages: readonly Pick<ChatMessage, "role" | "content">[],
  nodes: readonly { id: string; title: string }[],
  titleToRef?: ReadonlyMap<string, string>,
  standIns?: StandIns,
  standInByTitle?: ReadonlyMap<string, string>,
): Map<string, number> {
  const nodeIds = new Set<string>();
  const idByTitle = new Map<string, string>();
  for (const n of nodes) {
    nodeIds.add(n.id);
    // 同じ題名が複数あるときは先のもの（グラフの並びの先＝知見が先に来る）を使う
    if (n.title && !idByTitle.has(n.title)) idByTitle.set(n.title, n.id);
  }
  const resolve = (title: string): readonly string[] => {
    const raw = titleToRef?.get(title);
    if (raw) {
      const ref = toUsageRef(raw);
      const ids = ref ? refToPlottedIds(ref, nodeIds, standIns) : [];
      if (ids.length > 0) return ids;
    }
    const byTitle = idByTitle.get(title);
    if (byTitle) return [byTitle];
    // 点の無いページ（要約・素材）の題名なら、代わりの点
    const standIn = standInByTitle?.get(title);
    return standIn ? (standIns?.get(standIn) ?? []) : [];
  };

  const answers = messages.filter((m) => m.role === "assistant");
  const out = new Map<string, number>();
  // いちばん新しい答えのページを先に（引用された順に）並べ、前の答えのページを後ろに足す
  for (let i = answers.length - 1; i >= 0; i--) {
    const weight = i === answers.length - 1 ? 1 : EARLIER_WEIGHT;
    for (const title of citedTitles(answers[i].content)) {
      for (const id of resolve(title)) if (!out.has(id)) out.set(id, weight);
    }
  }
  return out;
}

/** 重みの中身が同じかを比べるための署名（同じなら同じ Map を使い回し、発火し直さない） */
export function usedPagesSignature(weights: ReadonlyMap<string, number>): string {
  return [...weights].map(([id, w]) => `${id}=${w}`).join("|");
}

const WEB_LINK_RE = /\]\((https?:\/\/[^)\s]+)\)/g;

/** 本文に出てくる Web の出典（Markdown リンクの URL）の数（重複なし） */
export function countWebSources(content: string): number {
  const urls = new Set<string>();
  for (const m of content.matchAll(WEB_LINK_RE)) urls.add(m[1]);
  return urls.size;
}

/** いちばん新しい答えの Web の出典の数（答えが無ければ 0） */
export function latestWebSourceCount(messages: readonly Pick<ChatMessage, "role" | "content">[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") return countWebSources(messages[i].content);
  }
  return 0;
}

/** AI に渡した文脈（retriever・道具の結果）の番号付き見出し `[#N | (Kind |) "題名"]` */
const CONTEXT_TITLE_RE = /\[#\d+\s*\|\s*(?:[^|"]+\|\s*)?"([^"]+)"\]/g;

/** 文脈に出てくるページの題名（出てきた順・重複なし）。AI が「読んだ」ページ */
export function contextTitles(context: string): string[] {
  const out: string[] = [];
  for (const m of context.matchAll(CONTEXT_TITLE_RE)) {
    const t = m[1].trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * 会話で AI が読んだページ（グラフのノード ID）。答えに記録した readRefs と、
 * 答えを待っているあいだに読んでいるページ（liveRefs）を合わせる。点の無いページは
 * 代わりの点（standIns）に寄せ、それも無いものは落とす（数は unplottedPages で出す）。
 */
export function chatReadPageIds(
  messages: readonly Pick<ChatMessage, "role" | "readRefs">[],
  nodeIds: ReadonlySet<string>,
  liveRefs: readonly string[] = [],
  standIns?: StandIns,
): Set<string> {
  const out = new Set<string>();
  const add = (ref: string) => {
    for (const id of refToPlottedIds(ref, nodeIds, standIns)) out.add(id);
  };
  for (const m of messages) if (m.role === "assistant") for (const r of m.readRefs ?? []) add(r);
  for (const r of liveRefs) add(r);
  return out;
}

/**
 * 範囲の外で使った・読んだページ（赤い点線の輪と見出しの数）。
 * - いちばん新しい答えで引用したページ（重み 1）は、その答えを出したときの範囲（usedScope）で見る
 * - 読んだページ（readIds）は readScope で見る。答えを待っているあいだはいまの範囲、
 *   答えが返ったあとはその答えを出したときの範囲を渡す
 * 範囲が null（すべて）なら、その側は判定しない。@ で渡したページは範囲の外でも数えない。
 */
export function outOfScopePageIds(opts: {
  weights: ReadonlyMap<string, number>;
  readIds: ReadonlySet<string>;
  usedScope: ReadonlySet<string> | null;
  readScope: ReadonlySet<string> | null;
  attached?: ReadonlySet<string>;
}): Set<string> {
  const { weights, readIds, usedScope, readScope, attached } = opts;
  const out = new Set<string>();
  const outside = (scope: ReadonlySet<string> | null, id: string) => !!scope && !scope.has(id) && !attached?.has(id);
  for (const [id, w] of weights) if (w >= 0.999 && outside(usedScope, id)) out.add(id);
  for (const id of readIds) if (outside(readScope, id)) out.add(id);
  return out;
}

/**
 * いちばん新しい答え（または読んでいる途中）で AI が触れたページのうち、グラフに無いもの。
 * - placed: 点の無いページを、元のノートや出典の点で示した数（要約・素材）
 * - missing: 代わりの点も無く、グラフでは示せなかった数
 * 読んだページ（refs）と引用した題名（citedTitles）を合わせ、同じページは 1 つに数える。
 */
export function unplottedPages(opts: {
  refs: readonly string[];
  citedTitles: readonly string[];
  nodes: readonly { id: string; title: string }[];
  titleToRef?: ReadonlyMap<string, string>;
  standIns?: StandIns;
  standInByTitle?: ReadonlyMap<string, string>;
}): { placed: number; missing: number } {
  const { refs, citedTitles: titles, nodes, titleToRef, standIns, standInByTitle } = opts;
  const nodeIds = new Set(nodes.map((n) => n.id));
  const nodeTitles = new Set(nodes.map((n) => n.title));
  // キーはグラフの ID（引けない題名は題名そのもの）。同じページを読んで引用しても 1 つ
  const placed = new Set<string>();
  const missing = new Set<string>();
  const judge = (graphId: string) => {
    if (nodeIds.has(graphId)) return;
    if ((standIns?.get(graphId)?.length ?? 0) > 0) placed.add(graphId);
    else missing.add(graphId);
  };
  for (const ref of refs) {
    const id = usageRefToGraphId(ref);
    if (id) judge(id);
  }
  for (const title of titles) {
    const raw = titleToRef?.get(title);
    const ref = raw ? toUsageRef(raw) : null;
    const id = ref ? usageRefToGraphId(ref) : null;
    const standIn = id ? null : standInByTitle?.get(title);
    if (id) judge(id);
    else if (standIn) judge(standIn);
    // 参照が引けず、題名でもグラフに見つからない引用は、示せなかったものとして数える
    else if (!nodeTitles.has(title)) missing.add(`title:${title}`);
  }
  return { placed: placed.size, missing: missing.size };
}
