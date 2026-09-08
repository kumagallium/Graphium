// PDF ビューア内テキスト検索のコアロジック。
//
// pdf.js の text-layer は「描画済みページの DOM」としてしか存在しないため、
// 検索は textLayer の Text ノードを走査して行う（pdf.js の textContent を
// 別途取り直すと、ハイライト用の Range を DOM に対して作れない）。
//
// text-layer の span は視覚的な行・断片ごとに切れていて、span をそのまま
// 連結すると行末と次行の先頭が繋がる（"end of" + "line" → "end ofline"）。
// そこで span 境界を空白 1 つとして扱い、連続空白を 1 つに畳んだ
// 「正規化テキスト」を作る。同時に、正規化後の 1 文字ごとに元の Text ノードと
// オフセットを覚えておき、マッチ位置から Range を復元できるようにする。

/** 正規化テキストの 1 文字が、DOM のどこから来たか。 */
export type CharSource = {
  node: Text;
  /** node.data 内のオフセット。 */
  offset: number;
};

export type PageTextIndex = {
  /** 正規化済みテキスト。 */
  text: string;
  /** text[i] の由来。長さは text.length と一致する。 */
  sources: CharSource[];
};

export type PdfSearchMatch = {
  pageNumber: number;
  /** ページ内の正規化テキスト上の開始位置（同一ページ内の順序付けに使う）。 */
  start: number;
  range: Range;
};

const WHITESPACE = /\s/;

/**
 * text-layer 要素（1 ページ分）から検索用インデックスを作る。
 *
 * - Text ノードを文書順に走査する
 * - 空白は 1 つに畳む（改行・タブ・全角スペース含む）
 * - Text ノードの境界は空白 1 つとして扱う（行末と次行が繋がらないように）
 */
export function buildPageTextIndex(pageEl: Element): PageTextIndex {
  const layer = pageEl.querySelector(".textLayer") ?? pageEl;
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  let chars = "";
  const sources: CharSource[] = [];
  // 直前に出力した文字が空白か。先頭の空白は捨てたいので true 始まり。
  let prevWasSpace = true;
  // ノード境界をまたいだ直後か（次の非空白の前に空白を 1 つ入れる）。
  let pendingBoundary = false;

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const data = text.data;
    if (data.length === 0) continue;
    for (let i = 0; i < data.length; i++) {
      const ch = data[i];
      if (WHITESPACE.test(ch)) {
        if (!prevWasSpace) {
          chars += " ";
          sources.push({ node: text, offset: i });
          prevWasSpace = true;
        }
        pendingBoundary = false;
        continue;
      }
      if (pendingBoundary && !prevWasSpace) {
        // ノード境界の暗黙の区切り。位置は「次の文字の直前」に寄せる。
        chars += " ";
        sources.push({ node: text, offset: i });
      }
      pendingBoundary = false;
      chars += ch;
      sources.push({ node: text, offset: i });
      prevWasSpace = false;
    }
    pendingBoundary = true;
  }

  return { text: chars, sources };
}

/**
 * 検索用に文字列を畳む。
 * 大文字小文字を無視する場合でも、1 文字が 2 文字になる変換（"ß" → "ss" 等）で
 * インデックスがずれると Range が壊れるため、長さが変わる文字は元のまま残す。
 */
function foldForSearch(text: string, caseSensitive: boolean): string {
  if (caseSensitive) return text;
  let out = "";
  for (const ch of text) {
    const lower = ch.toLowerCase();
    out += lower.length === ch.length ? lower : ch;
  }
  return out;
}

/** クエリを正規化する（バー側の入力にも空白の畳み込みを合わせる）。 */
export function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, " ");
}

/**
 * インデックス上でクエリの出現位置（開始オフセット）をすべて返す。
 * 重なりは数えない（"aa" を "aaa" から探すと 1 件）。
 */
export function findMatchOffsets(
  index: PageTextIndex,
  query: string,
  caseSensitive: boolean,
): number[] {
  const q = normalizeQuery(query);
  // 空白だけのクエリはヒット扱いにしない（searchPages 側と挙動を揃える）。
  if (!q.trim()) return [];
  const haystack = foldForSearch(index.text, caseSensitive);
  const needle = foldForSearch(q, caseSensitive);
  if (needle.length === 0 || haystack.length < needle.length) return [];
  const offsets: number[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    offsets.push(at);
    from = at + needle.length;
  }
  return offsets;
}

/**
 * 正規化テキスト上の [start, end) を DOM の Range に戻す。
 * 範囲が空、またはインデックス外なら null。
 */
export function rangeForOffsets(
  index: PageTextIndex,
  start: number,
  end: number,
): Range | null {
  if (end <= start) return null;
  const first = index.sources[start];
  const last = index.sources[end - 1];
  if (!first || !last) return null;
  const range = document.createRange();
  try {
    range.setStart(first.node, first.offset);
    range.setEnd(last.node, Math.min(last.offset + 1, last.node.data.length));
  } catch {
    return null;
  }
  return range;
}

/**
 * 集めるマッチ数の上限。
 * 1 文字だけ打った瞬間に長い PDF 全体が当たると、Range を数万個作って
 * それを全部塗ることになり、UI が固まる。件数がここまで来たら、それ以上は
 * 数えても読む役に立たないので打ち切る（バーは "2000+" と表示する）。
 */
export const MAX_MATCHES = 2000;

/**
 * ページ要素の集合（data-page-number 付き）を走査して、全マッチを
 * ページ順・ページ内出現順に並べて返す。MAX_MATCHES で打ち切る。
 */
export function searchPages(
  pageEls: Iterable<[number, Element]>,
  query: string,
  caseSensitive: boolean,
): PdfSearchMatch[] {
  const q = normalizeQuery(query);
  if (!q.trim()) return [];
  const pages = [...pageEls].sort((a, b) => a[0] - b[0]);
  const matches: PdfSearchMatch[] = [];
  for (const [pageNumber, el] of pages) {
    const index = buildPageTextIndex(el);
    if (!index.text) continue;
    for (const start of findMatchOffsets(index, q, caseSensitive)) {
      const range = rangeForOffsets(index, start, start + q.length);
      if (range) matches.push({ pageNumber, start, range });
      if (matches.length >= MAX_MATCHES) return matches;
    }
  }
  return matches;
}

/** CSS Custom Highlight API のハイライト名。styles 側の ::highlight() と対。 */
export const PDF_HIGHLIGHT_NAME = "gph-pdf-match";
export const PDF_HIGHLIGHT_ACTIVE_NAME = "gph-pdf-match-active";

type HighlightRegistryLike = {
  set: (name: string, highlight: unknown) => void;
  delete: (name: string) => void;
};

function highlightRegistry(): HighlightRegistryLike | null {
  // CSS Custom Highlight API 非対応環境（古いブラウザ・jsdom）では CSS 自体が
  // 無いこともある。ハイライトは諦め、件数表示とヒット間移動だけを効かせる。
  if (typeof CSS === "undefined") return null;
  const registry = (CSS as unknown as { highlights?: HighlightRegistryLike }).highlights;
  const ctor = (globalThis as unknown as { Highlight?: unknown }).Highlight;
  if (!registry || typeof ctor !== "function") return null;
  return registry;
}

/**
 * マッチをハイライトする。CSS Custom Highlight API 非対応の環境では
 * 何もしない（ヒット件数と該当箇所へのスクロールだけが効く）。
 */
export function applyHighlights(matches: PdfSearchMatch[], activeIndex: number): void {
  const registry = highlightRegistry();
  if (!registry) return;
  // Range は spread ではなく add で入れる。`new Highlight(...ranges)` は
  // ヒット数がそのまま引数の数になるので、多いとスタックを溢れさせる。
  const Ctor = (globalThis as unknown as {
    Highlight: new () => { add: (r: Range) => void };
  }).Highlight;
  const others = new Ctor();
  let otherCount = 0;
  for (let i = 0; i < matches.length; i++) {
    if (i === activeIndex) continue;
    others.add(matches[i].range);
    otherCount++;
  }
  if (otherCount > 0) registry.set(PDF_HIGHLIGHT_NAME, others);
  else registry.delete(PDF_HIGHLIGHT_NAME);
  const active = matches[activeIndex]?.range;
  if (active) {
    const activeHl = new Ctor();
    activeHl.add(active);
    registry.set(PDF_HIGHLIGHT_ACTIVE_NAME, activeHl);
  } else {
    registry.delete(PDF_HIGHLIGHT_ACTIVE_NAME);
  }
}

/** ハイライトを全部消す（検索バーを閉じたとき・アンマウント時）。 */
export function clearHighlights(): void {
  const registry = highlightRegistry();
  if (!registry) return;
  registry.delete(PDF_HIGHLIGHT_NAME);
  registry.delete(PDF_HIGHLIGHT_ACTIVE_NAME);
}
