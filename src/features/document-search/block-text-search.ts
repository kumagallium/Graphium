// ノート内検索（Cmd+F）で、エディタ本文の外にある文字も探す
//
// 音声ノートのブロックのように、中身を ProseMirror の文書に持たない（content: "none"）ブロックは、
// 本文の検索（search-plugin の decoration）に引っかからない。そこでブロックが描いた画面の文字のうち、
// SEARCH_SCOPE_ATTR を付けた要素の中だけを DOM から探し、Range で持つ。
// 強調は CSS Custom Highlight API で付ける（React が描いた DOM を書き換えないため）。
// 本文のヒットと画面上の並び順で混ぜて、件数と ↑↓ の移動を 1 つにする。

/** 検索の対象にする、ブロックが描いた文字の囲い（音声ノートの発言・清書・要約） */
export const SEARCH_SCOPE_ATTR = "data-gph-search-scope";

/** CSS Custom Highlight の名前（app.css の ::highlight と揃える） */
export const HIGHLIGHT_ALL = "gph-search";
export const HIGHLIGHT_ACTIVE = "gph-search-active";

/** root の中の検索の囲いから、query の一致を画面の並び順で返す（テキストノードごとに探す） */
export function findScopeRanges(root: ParentNode, query: string, caseSensitive: boolean): Range[] {
  const out: Range[] = [];
  if (!query) return out;
  const needle = caseSensitive ? query : query.toLowerCase();
  const scopes = root.querySelectorAll(`[${SEARCH_SCOPE_ATTR}]`);
  for (const scope of scopes) {
    // 囲いの中の囲いは外側で数える（二重に数えない）
    if (scope.parentElement?.closest(`[${SEARCH_SCOPE_ATTR}]`)) continue;
    const doc = scope.ownerDocument;
    const walker = doc.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue ?? "";
      const hay = caseSensitive ? text : text.toLowerCase();
      let idx = 0;
      while ((idx = hay.indexOf(needle, idx)) !== -1) {
        const r = doc.createRange();
        r.setStart(node, idx);
        r.setEnd(node, idx + query.length);
        out.push(r);
        idx += needle.length;
      }
    }
  }
  return out;
}

/** 画面上の位置（ノードと位置）で前後を比べる。a が前なら負 */
export function comparePoints(
  a: { node: Node; offset: number },
  b: { node: Node; offset: number },
): number {
  if (a.node === b.node) return a.offset - b.offset;
  const doc = a.node.ownerDocument ?? (a.node as Document);
  const ra = doc.createRange();
  ra.setStart(a.node, a.offset);
  const rb = doc.createRange();
  rb.setStart(b.node, b.offset);
  return ra.compareBoundaryPoints(Range.START_TO_START, rb);
}

type HighlightRegistry = { set(name: string, h: unknown): void; delete(name: string): void };

function registry(): { highlights: HighlightRegistry; Highlight: new (...r: Range[]) => unknown } | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  const Highlight = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  return css?.highlights && Highlight ? { highlights: css.highlights, Highlight } : null;
}

/** 囲いの中の一致を強調する（使えない環境では何もしない。件数と移動は効く） */
export function paintScopeHighlights(ranges: Range[], active: Range | null): void {
  const reg = registry();
  if (!reg) return;
  const rest = ranges.filter((r) => r !== active);
  if (rest.length > 0) reg.highlights.set(HIGHLIGHT_ALL, new reg.Highlight(...rest));
  else reg.highlights.delete(HIGHLIGHT_ALL);
  if (active) reg.highlights.set(HIGHLIGHT_ACTIVE, new reg.Highlight(active));
  else reg.highlights.delete(HIGHLIGHT_ACTIVE);
}

export function clearScopeHighlights(): void {
  const reg = registry();
  if (!reg) return;
  reg.highlights.delete(HIGHLIGHT_ALL);
  reg.highlights.delete(HIGHLIGHT_ACTIVE);
}
