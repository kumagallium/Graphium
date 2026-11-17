// 引用した一節の「前後の文」を控え、あとで書き換わったかを確かめる（AI は使わない）。
//
// 一節そのものが残っていても、直前・直後の文が書き換わると、一節の意味が変わることがある
// （「収率は 65% だった」の次の文が「ただし校正前の値」に変わる、など）。書いたときのノートの
// 前後の文を WikiMeta.passageContexts に控え、ページを開いたときに今のノートの前後の文と比べる。
//
// 誤報を減らすための決まり:
// - 比べるのは、一節のすぐ前とすぐ後ろの 1 文ずつ。離れた場所の変更は見ない
// - すぐ隣に文が書き足された（「…65% だった。」の直後に「ただし校正前の値。」）も「変わった」
//   — 意味がずれるいちばんよくある形なので、隣が入れ替わったことを知らせる
// - ノートの先頭・末尾にあった一節の外側（控えに前後の文が無い側）への書き足しは見ない
//   （ノートの末尾への追記は、いちばんよくある関係ない編集）
// - 数字が同じで、ほかが 2 字以内の違い（誤字の修正）なら、変わっていないとみなす
// - 隣の文が消えた・入れ替わった・数字が変わった・3 字以上変わった、のどれかで「変わった」とする
// 文の区切りは、行と「。！？」、欧文の「. ! ?」のあとの空白。表の行・箇条書きは 1 行が 1 文。

import type { PassageContext } from "../../lib/document-types";
import { SOURCE_CITATION_RE, normalizeForPassageMatch, splitPassage, MIN_PASSAGE_MATCH_LENGTH } from "../../lib/source-citations";
import { parseExternalSource } from "../network-graph/external-source";

/** 控える前後の文の長さの上限（字）。長い段落は一節に近い側を残す */
export const PASSAGE_CONTEXT_MAX_CHARS = 240;
/** 一節の前後で見る文の数（すぐ隣の 1 文だけ） */
const NEIGHBOR_REACH = 1;
/** 誤字の修正とみなす違いの上限（正規化後の字数・数字は別に比べる） */
const TYPO_EDIT_LIMIT = 2;

/** 文に分ける（行ごと → 「。！？」と、欧文の文末記号のあとの空白で） */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\n+/)) {
    for (const part of line.split(/(?<=[。！？])|(?<=[.!?])\s+/)) {
      const s = part.trim();
      if (s) out.push(s);
    }
  }
  return out;
}

const clipTail = (s: string) => (s.length <= PASSAGE_CONTEXT_MAX_CHARS ? s : s.slice(s.length - PASSAGE_CONTEXT_MAX_CHARS));
const clipHead = (s: string) => (s.length <= PASSAGE_CONTEXT_MAX_CHARS ? s : s.slice(0, PASSAGE_CONTEXT_MAX_CHARS));

/** 一節の出てくる場所ごとに、前後の文（それぞれ近い順に NEIGHBOR_REACH 文まで。最大 20 か所） */
function neighborsOf(passage: string, text: string): Array<{ before: string[]; after: string[] }> {
  const p = normalizeForPassageMatch(passage).replace(/[.,;:!?]+$/, "");
  if (p.length < MIN_PASSAGE_MATCH_LENGTH) return [];
  const units = splitSentences(text);
  const norms = units.map((u) => normalizeForPassageMatch(u));
  const starts: number[] = [];
  let joined = "";
  for (const n of norms) { starts.push(joined.length); joined += n; }
  const unitAt = (offset: number) => {
    let i = 0;
    while (i + 1 < starts.length && starts[i + 1] <= offset) i++;
    return i;
  };
  const out: Array<{ before: string[]; after: string[] }> = [];
  for (let at = joined.indexOf(p); at >= 0 && out.length < 20; at = joined.indexOf(p, at + 1)) {
    const first = unitAt(at);
    const last = unitAt(at + p.length - 1);
    const before: string[] = [];
    const after: string[] = [];
    for (let k = 1; k <= NEIGHBOR_REACH; k++) {
      if (first - k >= 0) before.push(units[first - k]);
      if (last + k < units.length) after.push(units[last + k]);
    }
    out.push({ before, after });
  }
  return out;
}

/** ノートの今の文字での、一節の前後の文（最初に出てくる場所）。一節が見つからなければ undefined */
export function contextOf(passage: string, text: string): { before?: string; after?: string } | undefined {
  const first = neighborsOf(passage, text)[0];
  if (!first) return undefined;
  return {
    ...(first.before[0] !== undefined ? { before: clipTail(first.before[0]) } : {}),
    ...(first.after[0] !== undefined ? { after: clipHead(first.after[0]) } : {}),
  };
}

/** 本文の照合済みの一節（印の無いもの）を、資料 id と組で重複なく集める */
function citedPassages(markdown: string): Array<{ sourceId: string; passage: string }> {
  const seen = new Set<string>();
  const out: Array<{ sourceId: string; passage: string }> = [];
  for (const m of markdown.matchAll(SOURCE_CITATION_RE)) {
    const sourceId = m[1].trim();
    const { passage, unverified } = splitPassage(m[2]);
    if (!passage || unverified) continue;
    const key = `${sourceId}\u0000${passage}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ sourceId, passage });
  }
  return out;
}

/**
 * 保存する本文に合わせて、前後の文の控えを作り直す。
 * - 今回読んだノート（readSources）の一節: そのノートの文字から取り直す
 * - 読んでいないノートの一節: 前の控え（previous）の同じ一節をそのまま持ち越す
 * - 本文から消えた一節の控えは捨てる。ノート以外（pdf: / url: など）は控えない
 * 控えが 1 件も無ければ undefined（欄を足さない）。
 */
export function capturePassageContexts(
  markdown: string,
  readSources: Array<{ id: string; text: string }>,
  previous?: PassageContext[],
): PassageContext[] | undefined {
  const read = new Map(readSources.map((s) => [s.id, s.text]));
  const prev = new Map((previous ?? []).map((c) => [`${c.sourceId}\u0000${c.passage}`, c]));
  const out: PassageContext[] = [];
  for (const { sourceId, passage } of citedPassages(markdown)) {
    if (parseExternalSource(sourceId)) continue;
    const text = read.get(sourceId);
    if (text !== undefined) {
      const ctx = contextOf(passage, text);
      if (ctx) out.push({ sourceId, passage, ...ctx });
      continue;
    }
    const kept = prev.get(`${sourceId}\u0000${passage}`);
    if (kept) out.push(kept);
  }
  return out.length > 0 ? out : undefined;
}

/** 数字の並び（「65%」→「72%」を拾う） */
const digitsOf = (s: string) => (s.match(/\d+(?:\.\d+)?/g) ?? []).join(",");

/** 編集距離（上限つき。上限を超えたら limit + 1 を返す） */
function editDistanceWithin(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > limit) return limit + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** 控えた文と今の文が「同じ」か（誤字の修正までは同じとみなす。数字が変われば違う） */
export function sameSentence(was: string, now: string): boolean {
  const a = normalizeForPassageMatch(was);
  const b = normalizeForPassageMatch(now);
  if (a === b) return true;
  if (digitsOf(a) !== digitsOf(b)) return false;
  return editDistanceWithin(a, b, TYPO_EDIT_LIMIT) <= TYPO_EDIT_LIMIT;
}

/** 前後の文の変化（変わった側だけ。now が無ければ、その側の文が無くなった） */
export type PassageContextChange = {
  before?: { was: string; now?: string };
  after?: { was: string; now?: string };
};

/**
 * 控えた前後の文と、ノートの今の文字を比べる。変わっていなければ null。
 * 一節がノートに無いときも null（一節が消えたことは別に知らせる）。
 * 一節が何か所にもあれば、どれか 1 か所の前後が控えと同じなら変わっていないとみなす。
 */
export function passageContextChange(stored: PassageContext, text: string): PassageContextChange | null {
  if (stored.before === undefined && stored.after === undefined) return null;
  const places = neighborsOf(stored.passage, text);
  if (places.length === 0) return null;
  let firstChange: PassageContextChange | null = null;
  for (const { before, after } of places) {
    const change: PassageContextChange = {};
    // すぐ隣の文と比べる（隣に文が書き足されたときも、隣が入れ替わるので「変わった」）。
    // 控えに無い側（ノートの先頭・末尾だった側）は見ない
    if (stored.before !== undefined && (before[0] === undefined || !sameSentence(stored.before, clipTail(before[0])))) {
      change.before = { was: stored.before, ...(before[0] !== undefined ? { now: clipTail(before[0]) } : {}) };
    }
    if (stored.after !== undefined && (after[0] === undefined || !sameSentence(stored.after, clipHead(after[0])))) {
      change.after = { was: stored.after, ...(after[0] !== undefined ? { now: clipHead(after[0]) } : {}) };
    }
    if (!change.before && !change.after) return null;
    firstChange ??= change;
  }
  return firstChange;
}

/**
 * 保存するページの wikiMeta.passageContexts を、本文に合わせて作り直したページを返す（純関数）。
 * readSources は今回読んだ資料（その文字から前後の文を取り直す）。previous は持ち越す元の控え
 * （既定はページ自身の控え。統合では統合したページすべての控えを渡す）。
 */
export function withPassageContexts<T extends { wikiMeta?: { topicMarkdown?: string; passageContexts?: PassageContext[] } }>(
  doc: T,
  readSources: Array<{ id: string; text: string }>,
  previous: PassageContext[] | undefined = doc.wikiMeta?.passageContexts,
): T {
  const meta = doc.wikiMeta;
  if (!meta || typeof meta.topicMarkdown !== "string") return doc;
  const contexts = capturePassageContexts(meta.topicMarkdown, readSources, previous);
  const { passageContexts: _old, ...rest } = meta;
  return { ...doc, wikiMeta: contexts ? { ...rest, passageContexts: contexts } : rest };
}
