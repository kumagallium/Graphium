// ヒットしたチャンクから、表示用の抜粋（スニペット）を切り出す
//
// Composer の OCR 抜粋（buildOcrSnippet）と同じ見た目の 1 行スニペット。違いは
// 「複数の語」を強調できること（BM25 はクエリの語ごとに当たるので、最初に当たった
// 語の周辺を窓にし、窓内の全ての語を強調する）。

import { normalizeText } from "./tokenizer";

export type Snippet = {
  /** 表示用の 1 行テキスト（改行は潰し、切り詰めた側に … を付ける） */
  text: string;
  /** text 内の強調範囲（複数） */
  ranges: { start: number; end: number }[];
};

const SNIPPET_BEFORE = 24;
const SNIPPET_AFTER = 72;

/** テキスト中の各語の出現範囲（大文字小文字・NFKC 差を吸収するため両方正規化して比較） */
function occurrences(flat: string, terms: string[]): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const hay = flat.toLowerCase();
  const hayN = normalizeText(flat);
  // NFKC で長さが変わる文字（㎎ 等）は稀なので、長さが一致するときだけ NFKC 側も探す
  // （位置をそのまま元テキストの範囲として使えるのは長さが一致するときだけ）
  const targets: { text: string; normalize: boolean }[] =
    hayN.length === hay.length && hayN !== hay ? [{ text: hay, normalize: false }, { text: hayN, normalize: true }] : [{ text: hay, normalize: false }];
  for (const raw of terms) {
    for (const { text: target, normalize } of targets) {
      const needle = normalize ? normalizeText(raw) : raw.toLowerCase();
      if (!needle) continue;
      let from = 0;
      while (from <= target.length - needle.length) {
        const idx = target.indexOf(needle, from);
        if (idx < 0) break;
        out.push({ start: idx, end: idx + needle.length });
        from = idx + needle.length;
      }
    }
  }
  // 重なりをまとめる
  out.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: { start: number; end: number }[] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}

/**
 * スニペットを作る。terms は「生の入力語」と「ヒットしたトークン」を混ぜて渡してよい
 * （長い語が先に来るよう並べると強調が自然）。どの語も見つからなければ先頭を返す。
 */
export function buildSnippet(text: string, terms: string[], opts: { before?: number; after?: number } = {}): Snippet {
  const before = opts.before ?? SNIPPET_BEFORE;
  const after = opts.after ?? SNIPPET_AFTER;
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return { text: "", ranges: [] };

  const uniq = Array.from(new Set(terms.filter((t) => t && t.trim()))).sort((a, b) => b.length - a.length);
  const occ = occurrences(flat, uniq);
  if (occ.length === 0) {
    const cut = flat.length > before + after ? `${flat.slice(0, before + after)}…` : flat;
    return { text: cut, ranges: [] };
  }

  // 窓の中心は「最も長い語（= 入力の句に近い語）が最初に出る位置」。
  // 短い語（bigram など）の方が手前にあっても、そちらに引きずられない
  let anchor: { start: number; end: number } | undefined;
  for (const term of uniq) {
    const first = occurrences(flat, [term])[0];
    if (first) {
      anchor = first;
      break;
    }
  }
  const first = anchor ?? occ[0];
  const from = Math.max(0, first.start - before);
  const to = Math.min(flat.length, first.end + after);
  const head = from > 0 ? "…" : "";
  const tail = to < flat.length ? "…" : "";
  const windowText = head + flat.slice(from, to) + tail;
  const ranges = occ
    .filter((r) => r.start >= from && r.end <= to)
    .map((r) => ({ start: head.length + (r.start - from), end: head.length + (r.end - from) }));
  return { text: windowText, ranges };
}
