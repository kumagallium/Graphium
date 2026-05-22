// Scroll To Text Fragment 生成 (PR3-d Phase 3)
//
// W3C: https://wicg.github.io/scroll-to-text-fragment/
//
// 選択テキストから URL hash `#:~:text=...` の `text=` 部分を組み立てる。
// CitationBlockPreview の ↗ リンクが「原文の該当箇所」に戻るための情報源。
//
// 出力形式:
//   short: `text=Foo bar`             // 短い選択そのまま
//   long:  `text=Foo,bar`             // textStart,textEnd で挟む
//   amb:   `text=prefix-,Foo,-suffix` // 重複時に prefix / suffix で曖昧性解消
//
// Phase 3 で UrlReaderView から呼ばれる。

const SHORT_THRESHOLD = 80; // chars。これ以下なら全体をそのまま textStart に
const RANGE_HEAD = 16; // 長文時の textStart 取り分（先頭側 N chars）
const RANGE_TAIL = 16; // 長文時の textEnd 取り分（末尾側 N chars）
const CONTEXT_LEN = 12; // 曖昧性解消用の prefix / suffix 長さ

/**
 * 選択テキストから `text=...` 形式の URL fragment 引数を組み立てる。
 *
 * `fullText` 内に同じ文字列が複数回出現する場合、prefix-/-suffix で曖昧性を解消する。
 * 出現しない場合（normalize ズレ等）はそのまま返す。
 * encode は呼び出し側で `encodeURIComponent` するか、`buildHashFragment` を使う。
 */
export function buildTextFragment(selection: string, fullText: string): string | undefined {
  const clean = collapseWhitespace(selection);
  if (!clean) return undefined;

  if (clean.length <= SHORT_THRESHOLD) {
    const occurrences = countOccurrences(fullText, clean);
    if (occurrences <= 1) {
      return `text=${encodePart(clean)}`;
    }
    // 重複あり → prefix / suffix で曖昧性解消
    const ctx = pickContext(fullText, clean);
    if (ctx) {
      const parts = ["text="];
      if (ctx.prefix) parts.push(`${encodePart(ctx.prefix)}-,`);
      parts.push(encodePart(clean));
      if (ctx.suffix) parts.push(`,-${encodePart(ctx.suffix)}`);
      return parts.join("");
    }
    return `text=${encodePart(clean)}`;
  }

  // 長文 → textStart,textEnd
  const head = clean.slice(0, RANGE_HEAD).trim();
  const tail = clean.slice(-RANGE_TAIL).trim();
  if (!head || !tail) return `text=${encodePart(clean.slice(0, SHORT_THRESHOLD))}`;

  return `text=${encodePart(head)},${encodePart(tail)}`;
}

/**
 * `#:~:text=...` 形式の完全な hash を組み立てる（URL に直接付けられる形）。
 */
export function buildHashFragment(selection: string, fullText: string): string | undefined {
  const fragment = buildTextFragment(selection, fullText);
  if (!fragment) return undefined;
  return `#:~:${fragment}`;
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  const normHaystack = collapseWhitespace(haystack);
  let count = 0;
  let idx = 0;
  while ((idx = normHaystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

function pickContext(
  fullText: string,
  selection: string,
): { prefix: string; suffix: string } | null {
  const norm = collapseWhitespace(fullText);
  // 1 回目の出現位置を起点に prefix / suffix を切り出す
  const idx = norm.indexOf(selection);
  if (idx === -1) return null;
  const prefixStart = Math.max(0, idx - CONTEXT_LEN);
  const suffixEnd = Math.min(norm.length, idx + selection.length + CONTEXT_LEN);
  const prefix = norm.slice(prefixStart, idx).trim();
  const suffix = norm.slice(idx + selection.length, suffixEnd).trim();
  return { prefix, suffix };
}

/**
 * Text Fragment の各セグメントを URL encode する。
 * `,` と `-` と `&` は特殊文字なので明示エスケープ。
 */
function encodePart(s: string): string {
  return encodeURIComponent(s)
    .replace(/,/g, "%2C")
    .replace(/-/g, "%2D")
    .replace(/&/g, "%26");
}
