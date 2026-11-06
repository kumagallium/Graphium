// 素材ビューアで選んだ文を「いま開いているノート」へ引用する口。
// ノートの横に素材をサイドピークで開いたときだけ、ノート側（NoteEditorInner）が Provider で包む。
// 入れ先がはっきりしている場面に限るため、素材一覧などノートが無い画面では値が null のまま
// （SelectionPill は「メモに保存」だけを出す）。
// PdfViewer / DocumentViewer / UrlReaderView を通すプロップを増やさずに済むよう context にした。

import { createContext, useContext } from "react";
import type { CitationSource } from "./SelectionPill";

export type SelectionQuoteTarget = {
  /** 選んだ文をメモに保存し、そのメモを開いているノートへ引用する */
  onQuoteToNote: (source: CitationSource) => void;
};

const SelectionQuoteContext = createContext<SelectionQuoteTarget | null>(null);

export const SelectionQuoteProvider = SelectionQuoteContext.Provider;

export function useSelectionQuoteTarget(): SelectionQuoteTarget | null {
  return useContext(SelectionQuoteContext);
}
