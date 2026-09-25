// @メンションを本文に入れるときの共通処理（メインエディタ・サイドピーク共通）。
//
// 素材の @リンクの挿入と、reference リンクの記録、インデックステーブルの行の紐付けを
// ここに集める。どちらのエディタも同じ関数を通す（片方だけ直す移植漏れを防ぐ。
// クリック側は mention-click.ts）。
//
// 表のセルに入れたときは、その行の tableRowIdentity をリンクに控える。表は 1 ブロックに
// 全セルのリンクが並ぶので、同じ表に同じラベル（試料ごとの data.txt 等）が並ぶと、
// ラベルとブロックだけではどの行のリンクか区別できない。

import type { NoteLink, TableMeta } from "../../lib/document-types";
import {
  syncTableRowIdentitiesToEditor,
  tableRowIdentityOfCell,
} from "../../lib/table-row-identity";
import { findColumnIndexByName, writeCellText } from "../table-meta/table-cells";
import { findColumnNameByType, hasColumnType } from "../table-meta/types";
import type { ReferenceSuggestion } from "./mention-menu";

/** reference リンクの記録口（メイン・ピークどちらの linkStore.addLink でも渡せる最小形） */
export type AddReferenceLink = (params: {
  sourceBlockId: string;
  targetBlockId: string;
  targetNoteId?: string;
  type: "reference";
  createdBy: "human";
  sourceRowIdentity?: string;
}) => unknown;

/** 表の中の行の位置（表ブロック ID と行の番号。0 は見出し行） */
export type TableRowPosition = { tableBlockId: string; rowIndex: number };

/** 表の中のセルの位置（行の位置と列の番号） */
export type TableCellPosition = TableRowPosition & { colIndex: number };

/**
 * カーソルがある表のセルを返す。表の外なら null。
 * BlockNote の表は blockContainer > table > tableRow > tableCell の入れ子で、
 * tableRow の並びは block.content.rows と、tableCell の並びはその行の cells と
 * 1 対 1 に対応する。
 */
export function tableCellAtCursor(editor: any): TableCellPosition | null {
  const $from = editor?._tiptapEditor?.state?.selection?.$from;
  if (!$from) return null;
  let rowIndex = -1;
  let colIndex = -1;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "tableRow") {
      rowIndex = $from.index(depth - 1);
      colIndex = $from.index(depth);
    }
    if (node.type.name === "blockContainer") {
      return rowIndex >= 0 ? { tableBlockId: node.attrs.id, rowIndex, colIndex } : null;
    }
  }
  return null;
}

/** カーソルがある表の行を返す。表の外なら null */
export function tableRowAtCursor(editor: any): TableRowPosition | null {
  const cell = tableCellAtCursor(editor);
  return cell ? { tableBlockId: cell.tableBlockId, rowIndex: cell.rowIndex } : null;
}

/**
 * @ で行とノートを紐付けるセルなら、その位置を返す。インデックステーブル（note-link の
 * ふるまいを持つ列がある表）の、その列の見出し行以外のセルにカーソルがあるときだけ。
 * 他の列（条件・メモ等）で打った @ は、本文と同じでそのセルに入る — 列を見ずに
 * 先頭列を書き換えていたため、2 列目で @ を打つと打っていない先頭列の中身が消えていた。
 * 表の注釈はエディタごと（メインとピークで別のストア）なので、読み口を渡す。
 */
export function noteLinkCellAtCursor(
  editor: any,
  getTableMeta: (tableBlockId: string) => TableMeta | undefined,
): TableCellPosition | null {
  const cell = tableCellAtCursor(editor);
  if (!cell || cell.rowIndex <= 0 || cell.colIndex < 0) return null;
  const meta = getTableMeta(cell.tableBlockId);
  if (!hasColumnType(meta, "note-link")) return null;
  const block = editor.getBlock?.(cell.tableBlockId);
  if (!block) return null;
  const noteLinkCol = findColumnIndexByName(block, findColumnNameByType(meta, "note-link"));
  return cell.colIndex === noteLinkCol ? cell : null;
}

/**
 * 表の行の identity を返す。保存時と同じ採番（未採番の行・コピーで重複した行の
 * 振り直し）をここで先に済ませてから読む — 行を足してすぐ @ を打つと、自動保存
 * （最後の変更から 3 秒後）の前なので行がまだ採番されていない。採番は文字に印を
 * 付けるだけなのでカーソルは動かない。見出し行・先頭セルが空の行は Entity では
 * ないので undefined。
 */
export function ensureTableRowIdentity(editor: any, row: TableRowPosition): string | undefined {
  if (!editor || row.rowIndex <= 0) return undefined;
  syncTableRowIdentitiesToEditor(editor);
  const cell = editor.getBlock?.(row.tableBlockId)?.content?.rows?.[row.rowIndex]?.cells?.[0];
  return tableRowIdentityOfCell(cell);
}

/**
 * @リンクの reference リンクを記録する。挿入の直後（カーソルが入れた文字の後ろに
 * あるうち）に呼ぶ。表のセルなら行の identity も控える。
 * row を渡すと、カーソルではなくその行に紐づける（セルを書き換えて入れる経路用）。
 */
export function recordMentionLink(
  editor: any,
  addLink: AddReferenceLink,
  params: { sourceBlockId: string; targetNoteId: string; row?: TableRowPosition | null },
): void {
  const row = params.row !== undefined ? params.row : tableRowAtCursor(editor);
  const sourceRowIdentity =
    row && row.tableBlockId === params.sourceBlockId ? ensureTableRowIdentity(editor, row) : undefined;
  addLink({
    sourceBlockId: params.sourceBlockId,
    targetBlockId: "",
    targetNoteId: params.targetNoteId,
    type: "reference",
    createdBy: "human",
    ...(sourceRowIdentity ? { sourceRowIdentity } : {}),
  });
}

/**
 * 行の紐付けの書き込み先。表の注釈・リンク・noteLinks はエディタのノートごとに違う
 * （ピークで紐付けたらピークのノートに入る）ので、呼び出し側が自分のものを渡す。
 */
export type RowNoteLinkOps = {
  /** 表の注釈に「行の値 → ノート」を控える（そのエディタの tableMetaStore.setNoteLink） */
  setNoteLink: (tableBlockId: string, rowValue: string, noteId: string) => void;
  addLink: AddReferenceLink;
  /** ノートの noteLinks（グラフ表示用の派生関係）を、今の配列から次の配列に置き換える */
  updateNoteLinks: (update: (links: NoteLink[]) => NoteLink[]) => void;
  /** 書き込みを始めたら呼ぶ（自動保存を起こす） */
  onLinked?: () => void;
};

/**
 * @ メニューで選んだ既存ノートを、インデックステーブルの行に紐付ける
 * （noteLinkCellAtCursor が返したセルで選んだとき）。紐付けないと行アイコン層は
 * その行を「ノートを作成」のまま出し、押すと「@名前」という題の重複ノートができる。
 * 1. 表の注釈に「@名前 → ノート」を控える（キーは書き換えた後のセルの文字）
 * 2. ノートの noteLinks に derived_from を足す（同じノートへの線が既にあれば足さない）
 * 3. 打ったセルを青い @名前 に書き換え、打った行に紐づく reference リンクを記録する。
 *    メニューが閉じて入力中の `@…` が片付いてから（ノートのメンションと同じく少し遅らせる）
 */
export function linkTableRowToNote(
  getEditor: () => any,
  cell: TableCellPosition,
  note: { id: string; label: string },
  ops: RowNoteLinkOps,
): void {
  const mention = `@${note.label}`;
  ops.setNoteLink(cell.tableBlockId, mention, note.id);
  ops.updateNoteLinks((links) =>
    links.some((l) => l.targetNoteId === note.id)
      ? links
      : [...links, { targetNoteId: note.id, sourceBlockId: cell.tableBlockId, type: "derived_from" }],
  );
  ops.onLinked?.();
  setTimeout(() => {
    const editor = getEditor();
    if (!editor) return;
    // 書き換えるのは打った列のセルだけ。他の列のセル・列幅・見出し行はそのまま残る
    writeCellText(editor, cell.tableBlockId, cell.rowIndex, cell.colIndex, mention, { textColor: "blue" });
    // セルを書き換えて入れる経路なので、カーソルではなく打った行に紐づける
    recordMentionLink(editor, ops.addLink, {
      sourceBlockId: cell.tableBlockId,
      targetNoteId: note.id,
      row: cell,
    });
  }, 100);
}

/** 素材候補のラベル先頭の種類アイコン（📄 / 🧾 / 🖼）を外した素材名 */
export function assetMentionName(suggestion: Pick<ReferenceSuggestion, "label">): string {
  return suggestion.label.replace(/^(📄|🧾|🖼)\s*/, "");
}

/**
 * @ メニューで選んだ素材を本文に入れる。
 * 画像はその場に見えるインライン画像（クリックで素材ピーク）。PDF・文書・データは
 * 青い `@素材名` を入れて、外部ソース ID（pdf:/document:/data:）の reference リンクを
 * 記録し、ノートの引用素材に積む（Cmd-K / チャットの AI がその素材の全文とハイライト
 * メモを読めるようになる）。メニューが閉じて入力中の `@…` が片付いてから入れるため、
 * ノートのメンションと同じく少し遅らせて挿入する。
 */
export function insertAssetMention(
  getEditor: () => any,
  sourceBlockId: string,
  suggestion: ReferenceSuggestion,
  ops: {
    addLink: AddReferenceLink;
    /** ノートの引用素材（citedAssetFileIds）に積む */
    citeAsset: (fileId: string) => void;
    onInserted?: () => void;
  },
): void {
  const name = assetMentionName(suggestion);
  if (suggestion.assetType === "image") {
    setTimeout(() => {
      getEditor()?.insertInlineContent([
        { type: "inlineImage", props: { fileId: suggestion.id, name } },
        { type: "text", text: " ", styles: {} },
      ]);
      ops.onInserted?.();
    }, 100);
    return;
  }
  ops.citeAsset(suggestion.id);
  setTimeout(() => {
    const editor = getEditor();
    if (!editor) return;
    editor.insertInlineContent([
      { type: "text", text: `@${name}`, styles: { textColor: "blue" } },
      { type: "text", text: " ", styles: {} },
    ]);
    recordMentionLink(editor, ops.addLink, {
      sourceBlockId,
      targetNoteId: `${suggestion.assetType ?? "document"}:${suggestion.id}`,
    });
    ops.onInserted?.();
  }, 100);
}
