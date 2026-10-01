// 白紙から作る新しいノートの「種」（まだ保存していない下書きの doc）。
//
// 種を作るのはフォルダ付きの新規ノートだけ。フォルダの無い新規ノートは null のまま開き、
// エディタ側（NoteEditorInner）が個人の設定「新しいノートを A4 の幅で始める」を読んで
// 本文の幅を決める。どの入口も同じ判定（newNoteBodyWidth）を通る。
// 自分で始めるノート（白紙・テンプレート・取り込み・計画の表の行から作るノート）が対象。
// 派生は元のノートの幅に従い（buildDerivedDocument など）、MCP・共有の fork・ナレッジは通らない。

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

/**
 * すでに組み上がった doc（テンプレート・取り込み・URL/PDF から作ったノートなど）に、
 * 設定「新しいノートを A4 の幅で始める」を当てる。
 *
 * doc 自身が幅を持っていればそれを優先する（テンプレートを作った人が選んだ幅）:
 * `fullWidth: true` か `paperSize` があれば何も足さない。設定が OFF なら元の doc をそのまま返す。
 */
export function applyNewNoteWidth<T extends object>(doc: T, startOnA4: boolean): T {
  const { fullWidth, paperSize } = doc as { fullWidth?: boolean; paperSize?: unknown };
  if (fullWidth === true || paperSize != null) return doc;
  const fields = newNoteWidthDocFields(startOnA4);
  return fields.paperSize ? { ...doc, ...fields } : doc;
}
