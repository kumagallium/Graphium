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
// - ノートの末尾にあった一節のあとへの書き足しは、一節と同じ数字か同じ語を含むときだけ「変わった」
//   （末尾への追記はいちばんよくある関係ない編集。ただし最後の文のすぐあとに書き足されるのは、
//   その文の訂正であることが多い — 「再測定したら収率は 58%」）。語は、欧文は 4 字以上の単語、
//   和文は漢字の 2 字の並びと 3 字以上のカタカナ語、ハングルは語の頭 2 字（よくある語を除く）。
//   日付・時刻と 1 桁の数字は、同じ数字に数えない
// - ノートの先頭にあった一節の前への書き足しは見ない
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

/** 一節と比べるときに語として数えない、欧文のよくある語（4 字以上。日誌によく出る語を含む） */
const COMMON_WORDS = new Set(
  ("about above after again also among around because been before being below between both could does doing down during each "
    + "even ever every first from further have having here however into just last less like made make many more most much must "
    + "next note notes only onto other over same second should since some such than that their them then there these they this "
    + "those through thus time today tomorrow under until upon very were what when where which while will with within without "
    + "would yesterday your").split(" "),
);
/** 語として数えない、和文のよくある漢字 2 字（日誌によく出る語） */
const COMMON_KANJI = new Set(
  ("今日 明日 昨日 翌日 本日 今回 次回 前回 午前 午後 時間 場合 必要 予定 確認 追記 記録 作業 開始 終了 以上 以下 今後 最初 最後").split(" "),
);

/**
 * 一節の「語」。欧文は 4 字以上の単語、和文は漢字の 2 字の並びと 3 字以上のカタカナ語、
 * ハングルは 2 字以上の語の頭 2 字（助詞が付いても同じ語として拾う）。よくある語は除く
 */
function keyTermsOf(text: string): { words: Set<string>; cjk: Set<string> } {
  const lower = text.toLowerCase();
  const words = new Set((lower.match(/[a-z\u00c0-\u024f]{4,}/g) ?? []).filter((w) => !COMMON_WORDS.has(w)));
  const cjk = new Set<string>();
  for (const run of text.match(/[\u4e00-\u9fff々]{2,}/g) ?? []) {
    for (let i = 0; i + 1 < run.length; i++) {
      const pair = run.slice(i, i + 2);
      if (!COMMON_KANJI.has(pair)) cjk.add(pair);
    }
  }
  for (const run of text.match(/[\u30a1-\u30faー]{3,}/g) ?? []) cjk.add(run);
  for (const run of text.match(/[\uac00-\ud7a3]{2,}/g) ?? []) cjk.add(run.slice(0, 2));
  return { words, cjk };
}

/**
 * 照合に使う数字の集まり（「65%」の 65）。日付・時刻（2026-11-18、11/18、11月18日、9:30）と 1 桁の整数は除く
 * — 追記の頭の日付や「手順 2」が、一節の数字とたまたま同じになるため
 */
const numbersOf = (s: string) =>
  new Set(
    (s.replace(/\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}|\d{1,2}[/:]\d{2}(?::\d{2})?|\d{1,4}\s*[年月日]/g, " ").match(/\d+(?:\.\d+)?/g) ?? [])
      .filter((n) => n.length > 1),
  );

/** 書き足された文が、一節と同じ数字か同じ語を含むか（一節の訂正・但し書きらしいか） */
export function sharesNumberOrTerm(passage: string, sentence: string): boolean {
  const a = passage.normalize("NFKC");
  const b = sentence.normalize("NFKC");
  const theirs = numbersOf(b);
  for (const n of numbersOf(a)) if (theirs.has(n)) return true;
  const mine = keyTermsOf(a);
  const other = keyTermsOf(b);
  for (const w of mine.words) if (other.words.has(w)) return true;
  for (const c of mine.cjk) if (b.includes(c)) return true;
  return false;
}

/**
 * 前後の文の変化（変わった側だけ）。now が無ければ、その側の文が無くなった。
 * after の was が無ければ、ノートの末尾だった一節のあとに文が書き足された。
 */
export type PassageContextChange = {
  before?: { was: string; now?: string };
  after?: { was?: string; now?: string };
};

/**
 * 控えた前後の文と、ノートの今の文字を比べる。変わっていなければ null。
 * 一節がノートに無いときも null（一節が消えたことは別に知らせる）。
 * 一節が何か所にもあれば、どれか 1 か所の前後が控えと同じなら変わっていないとみなす。
 */
export function passageContextChange(stored: PassageContext, text: string): PassageContextChange | null {
  const places = neighborsOf(stored.passage, text);
  if (places.length === 0) return null;
  let firstChange: PassageContextChange | null = null;
  for (const { before, after } of places) {
    const change: PassageContextChange = {};
    // すぐ隣の文と比べる（隣に文が書き足されたときも、隣が入れ替わるので「変わった」）。
    // 控えに前の文が無い（ノートの先頭だった）側は見ない
    if (stored.before !== undefined && (before[0] === undefined || !sameSentence(stored.before, clipTail(before[0])))) {
      change.before = { was: stored.before, ...(before[0] !== undefined ? { now: clipTail(before[0]) } : {}) };
    }
    if (stored.after !== undefined && (after[0] === undefined || !sameSentence(stored.after, clipHead(after[0])))) {
      change.after = { was: stored.after, ...(after[0] !== undefined ? { now: clipHead(after[0]) } : {}) };
    }
    // ノートの末尾だった一節のあとに書き足された文は、一節と同じ数字か語を含むときだけ知らせる
    if (stored.after === undefined && after[0] !== undefined && sharesNumberOrTerm(stored.passage, after[0])) {
      change.after = { now: clipHead(after[0]) };
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
