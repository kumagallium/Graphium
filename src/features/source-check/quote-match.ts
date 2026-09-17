// 出典照合（Source check, v1） — quote → blockId 対応付け、および quote の位置解決（v1: C）。
//
// サーバー側 quoteAppearsInSource（src/server/services/source-check.ts）と同じ正規化基準
// （NFKC + 連続空白圧縮 + trim）で「この quote はどのブロックに含まれるか」を探す。
// サーバーのモジュールはクライアントに import できない（バンドル境界。external-source.ts の
// コメント参照）ため、正規化ロジックをここに複製する。

import type { SourceCheckSourceKind, SourceQuoteLocation } from "../../lib/document-types";
import type { SourceTextBlock } from "./resolve-source-text";

function normalizeForMatch(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/**
 * quote を含む唯一のブロックが一意に分かるときだけ blockId を返す。
 * 複数ブロックにまたがる／どのブロックにも見つからない／複数ブロックに一致する場合は
 * undefined（「一意に分かるとき」という仕様の条件を厳密に守る — 曖昧な紐付けはしない）。
 */
export function findBlockIdForQuote(
  blocks: SourceTextBlock[] | undefined,
  quote: string | undefined,
): string | undefined {
  if (!blocks || !quote) return undefined;
  const q = normalizeForMatch(quote);
  if (!q) return undefined;
  const matches = blocks.filter((b) => normalizeForMatch(b.text).includes(q));
  return matches.length === 1 ? matches[0].id : undefined;
}

// ---------------------------------------------------------------------------
// quote 位置解決（v1: C）。
//
// LLM には何も書かせない。照合を実行したその場で、判定に使ったのと同じ原文テキストから
// 機械的に quote の位置（PDF のページ / Word の段落）を解く。判定（verdict）には影響しない
// ——位置が解けなくても verdict は変わらず、quoteLocation を付けないだけ。
// ---------------------------------------------------------------------------

// PDF 打ち切り注記の先頭（pdf-text-extractor.ts の extractPdfText が付ける文言と合わせる —
// バンドル境界の事情でここに複製する。値を変えるときは両方直すこと）。出現位置がこの注記内に
// 落ちたら「ページ無し」に倒すための境界検出に使う。
const PDF_TRUNCATION_MARKER = "\n\n[... truncated: read ";

/**
 * ハングル字母（分解形）の母音（V）・終声（T）か。NFKC はこれらを直前の初声（L）と
 * 正準合成（canonical composition）して 1 音節にまとめる仕様だが、これは文字列全体を
 * 一度に正規化したときにしか起きない（クラスタ単位で個別に正規化すると合成されない）。
 * 直前の初声のクラスタへ結合文字として取り込み、合成が起きる単位を保つ。
 */
function isHangulJamoVowelOrTrailing(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return (cp >= 0x1161 && cp <= 0x1175) || (cp >= 0x11a8 && cp <= 0x11c2);
}

/** 結合文字とみなす文字か（\p{M} に加え、半角カナの濁点・半濁点・分解形ハングルの母音/終声字母は
 *  Mark カテゴリではないため個別に含める） */
function isCombining(ch: string): boolean {
  return ch === "ﾞ" || ch === "ﾟ" || /\p{M}/u.test(ch) || isHangulJamoVowelOrTrailing(ch);
}

type Cluster = {
  start: number;
  end: number;
  text: string;
  /** クラスタを構成する各コードポイント自身の [start, end)（実際に合成が起きなかった場合の個別割り当て用） */
  codePointRanges: Array<{ start: number; end: number }>;
};

/** 元テキストを「基底文字 + 後続の結合文字」のクラスタに分ける（UTF-16 コード単位のオフセット付き） */
function buildClusters(text: string): Cluster[] {
  const codePoints = Array.from(text); // サロゲートペアを 1 要素として扱う
  const clusters: Cluster[] = [];
  let offset = 0;
  let i = 0;
  while (i < codePoints.length) {
    const start = offset;
    let clusterText = codePoints[i];
    const codePointRanges: Array<{ start: number; end: number }> = [
      { start: offset, end: offset + codePoints[i].length },
    ];
    offset += codePoints[i].length;
    i++;
    while (i < codePoints.length && isCombining(codePoints[i])) {
      clusterText += codePoints[i];
      codePointRanges.push({ start: offset, end: offset + codePoints[i].length });
      offset += codePoints[i].length;
      i++;
    }
    clusters.push({ start, end: offset, text: clusterText, codePointRanges });
  }
  return clusters;
}

/** 正規化後の 1 文字が元テキストのどの範囲 [start, end) から来たか */
type NormalizedMap = { text: string; ranges: Array<{ start: number; end: number }> };

/**
 * 元テキストをクラスタ単位で NFKC 正規化しつつ、各出力文字が元テキストのどの範囲から
 * 来たかを覚えておく。空白は連続を 1 つの半角空白にまとめ、先頭・末尾の空白は捨てる
 * （まとめた空白の end は最後の空白クラスタまで伸ばす）。
 */
function buildNormalizedMap(text: string): NormalizedMap {
  const clusters = buildClusters(text);
  const mappedChars: string[] = [];
  const mappedRanges: Array<{ start: number; end: number }> = [];
  for (const c of clusters) {
    const normChars = Array.from(c.text.normalize("NFKC"));
    // 各コードポイントを個別に NFKC したものを連結した結果が、クラスタ全体を一度に
    // NFKC した結果と一致するかどうかで場合分けする。一致するなら、各コードポイントは
    // 互いに影響し合わずに（分解を含めて）そのまま出力されているということなので、
    // 出力文字を対応する元コードポイント自身の範囲に個別に割り当てられる —— これは
    // 「結合文字候補と見なした文字が NFKC で複数文字に分解される」場合（例: 一部の
    // Mn 文字）も含む。一方、一致しなければ複数コードポイントにまたがる正準合成が
    // 実際に起きているということなので、クラスタ全体の範囲をまとめて割り当てる。
    // そうしないと、区切り文字まで巻き込んだ広すぎる範囲や、逆に狭すぎる範囲が
    // 誤って quote の一致位置として採用されてしまう。
    const rawCodePoints = Array.from(c.text);
    const perCodePointChars: string[] = [];
    const perCodePointRanges: Array<{ start: number; end: number }> = [];
    for (let idx = 0; idx < rawCodePoints.length; idx++) {
      const normalizedOne = Array.from(rawCodePoints[idx].normalize("NFKC"));
      for (const ch of normalizedOne) {
        perCodePointChars.push(ch);
        perCodePointRanges.push(c.codePointRanges[idx]);
      }
    }
    if (perCodePointChars.join("") === normChars.join("")) {
      for (let idx = 0; idx < perCodePointChars.length; idx++) {
        mappedChars.push(perCodePointChars[idx]);
        mappedRanges.push(perCodePointRanges[idx]);
      }
    } else {
      for (const ch of normChars) {
        mappedChars.push(ch);
        mappedRanges.push({ start: c.start, end: c.end });
      }
    }
  }

  let lo = 0;
  let hi = mappedChars.length;
  while (lo < hi && /\s/.test(mappedChars[lo])) lo++;
  while (hi > lo && /\s/.test(mappedChars[hi - 1])) hi--;

  const outChars: string[] = [];
  const outRanges: Array<{ start: number; end: number }> = [];
  for (let k = lo; k < hi; k++) {
    if (/\s/.test(mappedChars[k])) {
      const start = mappedRanges[k].start;
      let end = mappedRanges[k].end;
      let j = k;
      while (j + 1 < hi && /\s/.test(mappedChars[j + 1])) {
        j++;
        end = mappedRanges[j].end;
      }
      outChars.push(" ");
      outRanges.push({ start, end });
      k = j;
    } else {
      outChars.push(mappedChars[k]);
      outRanges.push(mappedRanges[k]);
    }
  }
  return { text: outChars.join(""), ranges: outRanges };
}

// 1 出典に依拠する文は同じ原文テキストで続けて照合されるため、直前の 1 件だけ覚えて使い回す
// （80,000 字で 1 回およそ 100ms かかり、文ごとに作り直すと UI を止める）。
let lastNormalized: { text: string; map: NormalizedMap } | undefined;

function normalizedMapFor(text: string): NormalizedMap {
  if (lastNormalized?.text !== text) {
    lastNormalized = { text, map: buildNormalizedMap(text) };
  }
  return lastNormalized.map;
}

/**
 * quote が出典原文のどこにあるか（元テキストの [start, end) の一覧、重なりは数えない）を返す。
 * 見つからなければ空配列。各出現は「正規化後に見つけた範囲を元テキストへ戻し、
 * その範囲を切り出して正規化した文字列が quote を含むか」を検証してから採用する
 * （fail-closed: クラスタ単位 NFKC と全体 NFKC がずれる稀なケースは出現なしに倒す）。
 */
export function locateQuoteRanges(
  text: string,
  quote: string | undefined,
): Array<{ start: number; end: number }> {
  if (!quote) return [];
  const q = normalizeForMatch(quote);
  if (!q || !text) return [];

  const { text: normText, ranges } = normalizedMapFor(text);
  if (normText.length < q.length) return [];

  const found: Array<{ start: number; end: number }> = [];
  let from = 0;
  for (;;) {
    const at = normText.indexOf(q, from);
    if (at === -1) break;
    from = at + q.length; // 重なりは数えない

    const startRange = ranges[at];
    const endRange = ranges[at + q.length - 1];
    if (!startRange || !endRange) continue;
    const start = startRange.start;
    const end = endRange.end;
    if (end <= start) continue;

    // 検証: クラスタ単位 NFKC の結果が全体 NFKC とずれていないか
    const slice = text.slice(start, end);
    if (!normalizeForMatch(slice).includes(q)) continue;

    found.push({ start, end });
  }
  return found;
}

/** 出現位置（元テキストのオフセット）から、largest i s.t. pageStarts[i] <= offset を返す（0 始まり） */
function pageIndexForOffset(pageStarts: number[], offset: number): number | undefined {
  if (pageStarts.length === 0 || offset < pageStarts[0]) return undefined;
  let lo = 0;
  let hi = pageStarts.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pageStarts[mid] <= offset) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/** PDF: 出現ごとのページ番号（1 始まり）を解く。打ち切り注記内に落ちた出現は undefined（ページ無し）扱い */
function resolvePdfPage(
  text: string,
  pageStarts: number[],
  range: { start: number; end: number },
): { page: number; pageEnd: number } | undefined {
  const noticeAt = text.indexOf(PDF_TRUNCATION_MARKER);
  if (noticeAt !== -1 && range.start >= noticeAt) return undefined;
  const startIdx = pageIndexForOffset(pageStarts, range.start);
  // end は排他境界なので、対応する文字は end-1
  const lastCharOffset = Math.max(range.start, range.end - 1);
  const clampedLastOffset = noticeAt !== -1 ? Math.min(lastCharOffset, noticeAt - 1) : lastCharOffset;
  const endIdx = pageIndexForOffset(pageStarts, clampedLastOffset);
  if (startIdx === undefined || endIdx === undefined) return undefined;
  return { page: startIdx + 1, pageEnd: endIdx + 1 };
}

/** Word: 出現ごとの段落番号（1 始まり）を解く。段落 = /\n[ \t]*\n/ で区切った非空の塊 */
function resolveParagraph(text: string, offset: number): number | undefined {
  const boundary = /\n[ \t]*\n/g;
  let paragraph = 1;
  let searchFrom = 0;
  let bodyStart = 0;
  for (;;) {
    boundary.lastIndex = searchFrom;
    const m = boundary.exec(text);
    if (!m) break;
    if (m.index >= offset) break;
    // 空の塊（区切りが連続するだけ）は段落として数えない
    const chunk = text.slice(bodyStart, m.index);
    if (chunk.trim().length > 0) paragraph++;
    bodyStart = m.index + m[0].length;
    searchFrom = m.index + m[0].length;
  }
  return paragraph;
}

export type QuoteLocationSource = {
  kind: SourceCheckSourceKind;
  text: string;
  /** PDF のときだけ（extractPdfText / resolveSourceText が渡す） */
  pageStarts?: number[];
};

/**
 * quote が出典原文のどこにあったかを解く。一意に決まらないとき（出現が複数あり、
 * ページ／段落がバラバラなとき）は undefined。PDF・Word 以外の出典種別は常に undefined。
 */
export function resolveQuoteLocation(
  source: QuoteLocationSource,
  quote: string | undefined,
): SourceQuoteLocation | undefined {
  const ranges = locateQuoteRanges(source.text, quote);
  if (ranges.length === 0) return undefined;

  if (source.kind === "pdf") {
    if (!source.pageStarts || source.pageStarts.length === 0) return undefined;
    const pages = ranges.map((r) => resolvePdfPage(source.text, source.pageStarts!, r));
    if (pages.some((p) => !p)) return undefined;
    const first = pages[0]!;
    const allSame = pages.every((p) => p!.page === first.page && p!.pageEnd === first.pageEnd);
    if (!allSame) return undefined;
    const loc: SourceQuoteLocation = { page: first.page };
    if (first.pageEnd !== first.page) loc.pageEnd = first.pageEnd;
    return loc;
  }

  if (source.kind === "document") {
    const paragraphs = ranges.map((r) => resolveParagraph(source.text, r.start));
    if (paragraphs.some((p) => p === undefined)) return undefined;
    const first = paragraphs[0]!;
    const allSame = paragraphs.every((p) => p === first);
    if (!allSame) return undefined;
    return { paragraph: first };
  }

  return undefined;
}
