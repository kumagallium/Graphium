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

import type { ChatMessage } from "../../lib/document-types";
import { toUsageRef } from "../ai-usage/usage-log";
import { usageRefToGraphId } from "../ai-usage/usage-activity";

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
 * 返す Map は「いちばん新しい答えのページ」が先に並ぶ（once の発火順）。
 */
export function chatUsedPageWeights(
  messages: readonly Pick<ChatMessage, "role" | "content">[],
  nodes: readonly { id: string; title: string }[],
  titleToRef?: ReadonlyMap<string, string>,
): Map<string, number> {
  const nodeIds = new Set<string>();
  const idByTitle = new Map<string, string>();
  for (const n of nodes) {
    nodeIds.add(n.id);
    // 同じ題名が複数あるときは先のもの（グラフの並びの先＝知見が先に来る）を使う
    if (n.title && !idByTitle.has(n.title)) idByTitle.set(n.title, n.id);
  }
  const resolve = (title: string): string | null => {
    const raw = titleToRef?.get(title);
    if (raw) {
      const ref = toUsageRef(raw);
      const id = ref ? usageRefToGraphId(ref) : null;
      if (id && nodeIds.has(id)) return id;
    }
    return idByTitle.get(title) ?? null;
  };

  const answers = messages.filter((m) => m.role === "assistant");
  const out = new Map<string, number>();
  // いちばん新しい答えのページを先に（引用された順に）並べ、前の答えのページを後ろに足す
  for (let i = answers.length - 1; i >= 0; i--) {
    const weight = i === answers.length - 1 ? 1 : EARLIER_WEIGHT;
    for (const title of citedTitles(answers[i].content)) {
      const id = resolve(title);
      if (id && !out.has(id)) out.set(id, weight);
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
 * 答えを待っているあいだに読んでいるページ（liveRefs）を合わせる。グラフに無いものは落とす。
 */
export function chatReadPageIds(
  messages: readonly Pick<ChatMessage, "role" | "readRefs">[],
  nodeIds: ReadonlySet<string>,
  liveRefs: readonly string[] = [],
): Set<string> {
  const out = new Set<string>();
  const add = (ref: string) => {
    const id = usageRefToGraphId(ref);
    if (id && nodeIds.has(id)) out.add(id);
  };
  for (const m of messages) if (m.role === "assistant") for (const r of m.readRefs ?? []) add(r);
  for (const r of liveRefs) add(r);
  return out;
}
