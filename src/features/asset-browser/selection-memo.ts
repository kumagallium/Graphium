// 素材で選んだ文からメモの出典（sourceAsset）を組み立てる。
// どの文から取ったか（quote）は、メモの本文とは別に持つ。本文は書き換えられるので、
// 本文から文を割り出す（PROV 書き出しが以前していたこと）と、書き換えた時点で失われる。

import type { MemoSourceAsset, TextQuoteAnchor } from "../mobile-capture";
import type { CitationSource } from "./SelectionPill";

/**
 * 選んだ文の TextQuoteAnchor。PDF はページの text-layer から前後付きで取り出す
 * （resolveQuote）。取れないとき・PDF 以外は、選んだ文（空白を 1 つに畳む）だけを持つ。
 */
export function resolveSelectionQuote(source: CitationSource): TextQuoteAnchor | null {
  let resolved: TextQuoteAnchor | null = null;
  try {
    resolved = source.resolveQuote?.() ?? null;
  } catch {
    // text-layer が作り直された直後などで Range が使えなくても、メモの保存は止めない
    resolved = null;
  }
  if (resolved && resolved.exact.trim()) return resolved;
  const exact = source.selectionText.replace(/\s+/g, " ").trim();
  return exact ? { exact } : null;
}

/** 選んだ文のメモに付ける出典（素材・ページ・文） */
export function buildSelectionSourceAsset(source: CitationSource): MemoSourceAsset {
  const quote = resolveSelectionQuote(source);
  return {
    fileId: source.entry.fileId,
    type: source.entry.type,
    ...(source.pageNumber !== undefined ? { pageNumber: source.pageNumber } : {}),
    ...(quote ? { quote } : {}),
  };
}
