// 白紙から作る新しいノートの「種」（まだ保存していない下書きの doc）。
//
// 種を作るのはフォルダ付きの新規ノートだけ。フォルダの無い新規ノートは null のまま開き、
// エディタ側（NoteEditorInner）が個人の設定「新しいノートを A4 の幅で始める」を読んで
// 本文の幅を決める。どちらの入口も同じ判定（newNoteBodyWidth）を通る。
// テンプレート・取り込み・AI・MCP・共有の fork はここを通らない。

import type { GraphiumDocument, PaperSize } from "../../lib/document-types";
import { bodyWidthToDocFields, newNoteBodyWidth } from "./body-width";

/**
 * 新しい白紙ノートの doc に足す本文の幅の項目。設定が OFF なら何も足さない（標準は項目なし）。
 * 種の doc と、`@` で作るタイトルだけのノートの両方がこれを展開する。
 */
export function newNoteWidthDocFields(startOnA4: boolean): { paperSize?: PaperSize } {
  const { paperSize } = bodyWidthToDocFields(newNoteBodyWidth(startOnA4));
  return paperSize ? { paperSize } : {};
}

/**
 * 新規ノートの下書きの doc。フォルダが無ければ null（エディタが空で開く）。
 * `noteContexts` は呼び出し側が normalizeNoteContexts で正規化した値（無ければ undefined）。
 */
export function buildNewNoteDraft(
  noteContexts: string[] | undefined,
  startOnA4: boolean,
): GraphiumDocument | null {
  if (!noteContexts) return null;
  return {
    title: "",
    pages: [],
    noteContexts,
    ...newNoteWidthDocFields(startOnA4),
  } as unknown as GraphiumDocument;
}
