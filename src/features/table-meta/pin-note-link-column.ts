// ノートへのリンクの列（note-link）を表の左端に保つ
//
// Graphium は「行の名前 = 先頭列」を、行のアイコン・行からノートを作る・工程グラフ・
// PROV の行 Entity・step の入出力・行の識別子まで前提にしている。ノートへのリンクの列を
// 右へ動かす（または別の列をその左へ動かす）と、@ でつないだノートは動かした列に、
// アイコンや PROV は先頭列に、と割れてしまう。そこで列の並びが変わったら、リンクの列を
// 左端へ戻す（docs/internal/table-column-properties-design.md §-2）。
//
// 列のふるまいは見出しの名前で持っている。リンクの列は常に先頭にあるので、注釈の名前が
// 見出しに見つからないときは「先頭列の見出しが書き換えられた」とみなして名前を付け替える。

import { freeColumnName } from "./column-behavior";
import { readCellText, writeCellText } from "./table-cells";
import { findColumnNameByType, type TableMeta } from "./types";

/** 表の content の index 列目を先頭へ動かした content を返す（各行のセルと列幅を同じ並びに） */
export function moveColumnToFront(content: any, index: number): any {
  const move = <T>(list: T[]): T[] =>
    index <= 0 || index >= list.length ? list : [list[index], ...list.slice(0, index), ...list.slice(index + 1)];
  const rows: any[] = content?.rows ?? [];
  const next: any = {
    ...content,
    rows: rows.map((row) => ({ ...row, cells: move(row?.cells ?? []) })),
  };
  if (Array.isArray(content?.columnWidths)) next.columnWidths = move(content.columnWidths);
  return next;
}

function countOf(list: string[], value: string): number {
  return list.reduce((n, v) => (v === value ? n + 1 : n), 0);
}

export type PinNoteLinkOptions = {
  /** 表の注釈を引く（ストアの最新） */
  metaOf: (blockId: string) => TableMeta | undefined;
  /** 先頭列の見出しが書き換わったとき、注釈の名前を付け替える */
  onRenameColumn?: (blockId: string, from: string, to: string) => void;
  /**
   * 見出しが空のまま設定された古い表（注釈の名前が空文字）の先頭列に入れる見出し。
   * 空の見出しの列が複数あるとリンクの列を見分けられないので、名前を入れて覚え直す
   */
  emptyHeaderName?: string;
};

/**
 * ノートへのリンクの列が先頭に無い表を見つけて、先頭へ戻す。editor.onChange から毎回
 * 呼んでよい（戻した回の onChange では先頭にあるので何もせず収束する）。
 */
export function pinNoteLinkColumns(
  editor: any,
  blockIds: Iterable<string>,
  options: PinNoteLinkOptions
): void {
  if (!editor) return;
  for (const blockId of blockIds) {
    const block = editor.getBlock?.(blockId);
    if (!block || block.type !== "table") continue;
    const name = findColumnNameByType(options.metaOf(blockId), "note-link");
    if (name === undefined) continue;
    const headers: string[] = (block.content?.rows?.[0]?.cells ?? []).map((c: any) => readCellText(c));
    if (headers.length === 0) continue;

    if (name === "") {
      // 見出しが空のまま設定された古い表。当時のリンクの列は先頭列なので、先頭列に名前を
      // 付けて（空なら emptyHeaderName を入れて）覚え直す。以後は名前で左端に保てる
      let first = headers[0];
      if (first === "" && options.emptyHeaderName) {
        first = freeColumnName(headers, options.emptyHeaderName);
        writeCellText(editor, blockId, 0, 0, first);
      }
      if (first !== "" && countOf(headers, first) <= 1) {
        options.onRenameColumn?.(blockId, "", first);
      }
      continue;
    }

    if (!headers.includes(name)) {
      // リンクの列は先頭にあるはずなので、先頭列の見出しが書き換えられた。
      // 空（打ち直しの途中）や他の列と同じ名前のうちは付け替えない
      const first = headers[0];
      if (first !== "" && countOf(headers, first) === 1) {
        options.onRenameColumn?.(blockId, name, first);
      }
      continue;
    }
    // 同じ見出しの列が複数あると、どれがリンクの列か決まらないので動かさない
    if (countOf(headers, name) > 1) continue;
    const index = headers.indexOf(name);
    if (index <= 0) continue;
    try {
      editor.updateBlock(blockId, { content: moveColumnToFront(block.content, index) });
    } catch {
      // 走査中のトランザクション競合などで失敗しても、次の onChange で再試行される
    }
  }
}
