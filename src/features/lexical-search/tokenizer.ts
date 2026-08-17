// 語彙インデックス（BM25）用のトークナイザ
//
// 日本語は空白で語が切れないので、素朴な `\s+` 分割では「湿度60%以上で劣化する」が
// 丸ごと 1 語になり、単語一致が事実上死ぬ（Wiki retriever のフォールバックが
// そうだった）。ここでは辞書を持ち込まず、ブラウザ / WKWebView / Node に組み込みの
// `Intl.Segmenter`（ICU の単語分割）を第一手段にし、無い環境では CJK bigram に
// 退化する。
//
// 方針:
// - NFKC 正規化 + 小文字化（全角英数・㎎ 等を揃える。化学式 "Bi2Te3" は 1 語のまま残る）
// - `Intl.Segmenter('ja', word)` の isWordLike セグメントを語とする
// - CJK を含む 3 文字以上のセグメントは、セグメント自身に加えて文字 bigram も出す。
//   単語分割は文脈依存で、クエリ側とノート側で「熱電変換材料」の切れ目が揃わない
//   ことがある。bigram を併記しておけば、どちらに切れても部分一致で拾える
// - 索引側とクエリ側で同じ関数を使う（MiniSearch の tokenize / processTerm に渡す）

/** CJK（漢字・ひらがな・カタカナ・ハングル・全角記号の一部）を含むか */
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ー]/u;
/** CJK 文字 1 つ */
const CJK_CHAR_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ー]/u;
/** 語として残す文字（文字・数字・アンダースコア）。記号のみのセグメントは捨てる */
const WORD_CHAR_RE = /[\p{L}\p{N}_]/u;

// tsconfig の lib は ES2020 で `Intl.Segmenter` の型を持たないため、必要最小限を自前で宣言する
// （実行時は Chrome 87+ / Safari 14.1+ / Node 16+ に組み込み。無ければ bigram に退化）
type WordSegment = { segment: string; isWordLike?: boolean };
type WordSegmenter = { segment(input: string): Iterable<WordSegment> };
type SegmenterCtor = new (locale: string, options: { granularity: "word" }) => WordSegmenter;

let segmenter: WordSegmenter | null | undefined;

/** `Intl.Segmenter` が使えるなら日本語 word セグメンタを返す（1 回だけ生成） */
function getSegmenter(): WordSegmenter | null {
  if (segmenter !== undefined) return segmenter;
  try {
    const S = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
    segmenter = S ? new S("ja", { granularity: "word" }) : null;
  } catch {
    segmenter = null;
  }
  return segmenter;
}

/** テスト用: セグメンタの有無を差し替える（`null` で bigram フォールバックを強制） */
export function __setSegmenterForTest(next: WordSegmenter | null | undefined): void {
  segmenter = next;
}

/** 正規化: NFKC + 小文字。索引側とクエリ側の両方で同じに揃える */
export function normalizeText(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

/** CJK 文字列の bigram（"熱電変換" → ["熱電","電変","変換"]）。2 文字未満は空 */
export function cjkBigrams(run: string): string[] {
  const chars = Array.from(run);
  if (chars.length < 2) return [];
  const out: string[] = [];
  for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i] + chars[i + 1]);
  return out;
}

/** 1 セグメントを語（複数可）に展開する */
function expandSegment(seg: string): string[] {
  if (!seg || !WORD_CHAR_RE.test(seg)) return [];
  if (CJK_RE.test(seg)) {
    const chars = Array.from(seg);
    // 3 文字以上の純 CJK 語はセグメント自身 + bigram。2 文字以下・混在はそのまま
    if (chars.length >= 3 && chars.every((c) => CJK_CHAR_RE.test(c))) {
      return [seg, ...cjkBigrams(seg)];
    }
    return [seg];
  }
  return [seg];
}

/**
 * フォールバック分割（`Intl.Segmenter` 無し）: 文字種の連なりで区切り、
 * CJK の連なりは bigram のみ（1〜2 文字なら連なりそのもの）、それ以外は語のまま。
 * 連なりは「語」ではなく「句」なので、連なり全体は語として出さない
 * （出すとクエリ側の短い句と一致しなくなる）。
 */
function tokenizeFallback(normalized: string): string[] {
  const out: string[] = [];
  const runs = normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ー]+|[\p{L}\p{N}_]+/gu) ?? [];
  for (const run of runs) {
    if (CJK_RE.test(run)) {
      const chars = Array.from(run);
      if (chars.length <= 2) out.push(run);
      else out.push(...cjkBigrams(run));
    } else {
      out.push(run);
    }
  }
  return out;
}

/**
 * テキストを検索語の配列にする。索引とクエリの両方で使う。
 * 重複は残す（BM25 の tf に効かせる）。
 */
export function tokenize(text: string): string[] {
  const normalized = normalizeText(text ?? "");
  if (!normalized) return [];
  const seg = getSegmenter();
  if (!seg) return tokenizeFallback(normalized);
  const out: string[] = [];
  for (const s of seg.segment(normalized)) {
    if (!s.isWordLike) continue;
    for (const tok of expandSegment(s.segment)) out.push(tok);
  }
  return out;
}

/** クエリ用: 重複を除いた語の配列（表示・ハイライト用途） */
export function queryTerms(text: string): string[] {
  return Array.from(new Set(tokenize(text)));
}

/** ハイライト用: テキスト中で語（生の入力語）が出現する範囲を返す（NFKC 差は無視して素朴に探す） */
export function findTermRanges(haystack: string, needle: string): { start: number; end: number }[] {
  if (!needle) return [];
  const ranges: { start: number; end: number }[] = [];
  const hay = haystack.toLowerCase();
  const nd = needle.toLowerCase();
  let from = 0;
  while (from <= hay.length - nd.length) {
    const idx = hay.indexOf(nd, from);
    if (idx < 0) break;
    ranges.push({ start: idx, end: idx + nd.length });
    from = idx + nd.length;
  }
  return ranges;
}
