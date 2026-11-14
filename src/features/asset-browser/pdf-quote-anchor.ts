// PDF の中の 1 文を「文そのもの＋前後の数十文字」で指す（TextQuoteAnchor）。
//
// - 選んだとき: 選択範囲（Range）から、ページの text-layer 上の文と前後を取り出す
// - 開くとき: ページの text-layer から同じ文を探し直し、前後がいちばん合う 1 か所を返す
//
// 位置（文字オフセットや座標）では持たない。ズームや pdf.js の版で text-layer の
// span の割り方が変わっても、文が同じなら見つけ直せるようにするため。
// 検索（pdf-search）と同じインデックス（空白を 1 つに畳んだテキスト）を使う。

import type { TextQuoteAnchor } from "../mobile-capture";
import {
  CJK,
  buildPageTextIndex,
  findMatchOffsets,
  rangeForOffsets,
  type PdfSearchMatch,
} from "./pdf-search";

/** 前後に持つ文字数。同じ文の見分けには十分で、メモの索引を太らせない長さ */
export const QUOTE_CONTEXT_CHARS = 32;

/**
 * ページ要素の中の選択範囲から、文と前後を取り出す。
 * 選択がこのページの text-layer の文字を 1 つも含まなければ null。
 */
export function quoteAnchorForRange(
  pageEl: Element,
  range: Range,
  contextChars: number = QUOTE_CONTEXT_CHARS,
): TextQuoteAnchor | null {
  const index = buildPageTextIndex(pageEl);
  let start = -1;
  let end = -1;
  for (let i = 0; i < index.sources.length; i++) {
    const { node, offset } = index.sources[i];
    // 文字 [offset, offset+1) がまるごと選択の中にあるか
    let inside = false;
    try {
      inside =
        range.comparePoint(node, offset) === 0 &&
        range.comparePoint(node, Math.min(offset + 1, node.data.length)) === 0;
    } catch {
      inside = false;
    }
    if (!inside) continue;
    if (start === -1) start = i;
    end = i + 1;
  }
  if (start === -1) return null;
  // 境界の空白は外す（選択の端の空白は文の一部ではない）
  while (start < end && index.text[start] === " ") start++;
  while (end > start && index.text[end - 1] === " ") end--;
  if (end <= start) return null;
  const exact = index.text.slice(start, end);
  const prefix = index.text.slice(Math.max(0, start - contextChars), start);
  const suffix = index.text.slice(end, end + contextChars);
  return {
    exact,
    ...(prefix ? { prefix } : {}),
    ...(suffix ? { suffix } : {}),
  };
}

/** a の末尾と b の末尾が何文字一致するか */
function commonSuffixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

/** a の先頭と b の先頭が何文字一致するか */
function commonPrefixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * 和文の隣の空白を抜いた文字列と、抜いた後の各文字が元の何文字目だったか。
 * 1 文字ずつ NFKC にかける（長さが変わる文字はそのまま。pdf-search の foldForSearch と同じ扱い）。
 */
function stripSpacesNextToCjk(text: string): { text: string; map: number[] } {
  let out = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      const before = text[i - 1] ?? "";
      const after = text[i + 1] ?? "";
      if (!before || !after || CJK.test(before) || CJK.test(after)) continue;
      out += " ";
      map.push(i);
      continue;
    }
    const folded = ch.normalize("NFKC");
    out += folded.length === ch.length ? folded : ch;
    map.push(i);
  }
  return { text: out, map };
}

/**
 * 和文の隣の空白を両側とも無視して探す（予備）。照合の原文（pdf-text-extractor）は文字片を
 * 必ず空白でつなぎ、text-layer の索引は和文どうしの境目に空白を入れないので、同じ文でも
 * 空白の位置がずれる。見つかれば索引上の [start, end) を返す。
 */
function findLooseOffsets(indexText: string, exact: string): Array<[number, number]> {
  const hay = stripSpacesNextToCjk(indexText);
  const needle = stripSpacesNextToCjk(exact.replace(/\s+/g, " ").trim()).text;
  if (!needle) return [];
  const found: Array<[number, number]> = [];
  let from = 0;
  for (;;) {
    const at = hay.text.indexOf(needle, from);
    if (at === -1) break;
    found.push([hay.map[at], hay.map[at + needle.length - 1] + 1]);
    from = at + needle.length;
  }
  return found;
}

/**
 * ページ群から文を探し直す。preferredPage（メモに残したページ）を先に見て、
 * そこに無ければ残りのページを順に見る（ページ番号がずれた版の PDF でも当たるように）。
 * 同じ文が何か所もあれば、前後がいちばん長く一致する 1 か所を選ぶ。見つからなければ null。
 */
export function locateQuoteInPages(
  pageEls: Iterable<[number, Element]>,
  anchor: TextQuoteAnchor,
  preferredPage?: number,
): PdfSearchMatch | null {
  if (!anchor.exact.trim()) return null;
  const pages = [...pageEls].sort((a, b) => {
    if (a[0] === preferredPage) return -1;
    if (b[0] === preferredPage) return 1;
    return a[0] - b[0];
  });
  for (const [pageNumber, el] of pages) {
    const index = buildPageTextIndex(el);
    if (!index.text) continue;
    const offsets = findMatchOffsets(index, anchor.exact, true);
    if (offsets.length === 0) {
      // 空白の位置だけ違う同じ文（和文の境目）を拾う。前後の照合はしない（最初の 1 か所）
      const loose = findLooseOffsets(index.text, anchor.exact);
      if (loose.length === 0) continue;
      const looseRange = rangeForOffsets(index, loose[0][0], loose[0][1]);
      if (looseRange) return { pageNumber, start: loose[0][0], range: looseRange };
      continue;
    }
    let best = offsets[0];
    let bestScore = -1;
    for (const at of offsets) {
      const before = index.text.slice(Math.max(0, at - (anchor.prefix?.length ?? 0)), at);
      const after = index.text.slice(at + anchor.exact.length, at + anchor.exact.length + (anchor.suffix?.length ?? 0));
      const score =
        commonSuffixLength(before, anchor.prefix ?? "") + commonPrefixLength(after, anchor.suffix ?? "");
      if (score > bestScore) {
        best = at;
        bestScore = score;
      }
    }
    const range = rangeForOffsets(index, best, best + anchor.exact.length);
    if (range) return { pageNumber, start: best, range };
  }
  return null;
}

/**
 * 素材を開いたときに見せる場所（引用ブロックの「出典を開く」から）。
 * key は開くたびに変える（同じ文をもう一度開いたときも、そこへ戻す）。
 */
export type MaterialFocus = {
  key: string;
  pageNumber?: number;
  quote?: TextQuoteAnchor;
};

/** 出典照合の結果から PDF を開くときに渡す、抜粋とページ（SourceCheckEntry の quote / quoteLocation.page） */
export type SourceCheckOpenAt = {
  quote?: string;
  page?: number;
};

/**
 * 出典照合の「出典を開く」で PDF を開くときの見せる場所。抜粋もページも無ければ undefined
 * （素材を頭から開くだけ）。前後の文脈は持っていないので、同じ文が何か所もあれば
 * ページ（あれば）の中の最初の 1 か所になる。
 */
export function focusFromSourceCheck(key: string, at: SourceCheckOpenAt | undefined): MaterialFocus | undefined {
  if (!at) return undefined;
  // 和文の境目の空白のずれは locateQuoteInPages の予備の照合が吸収する
  const exact = at.quote ? at.quote.replace(/\s+/g, " ").trim() : "";
  const pageNumber = at.page !== undefined && at.page >= 1 ? at.page : undefined;
  if (!exact && pageNumber === undefined) return undefined;
  return {
    key,
    ...(pageNumber !== undefined ? { pageNumber } : {}),
    ...(exact ? { quote: { exact } } : {}),
  };
}
