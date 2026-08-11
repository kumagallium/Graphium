// 記録テーブルへの行追加ユーティリティ
//
// 「+ 記録」ボタンから呼ばれ、テーブル末尾に新しいデータ行を足して
// 1 列目に現在日時（YYYY-MM-DD HH:MM）を自動記入する。
// 日時をセルの文字列として持つのは意図的な設計:
//   - 後から手で直せる（「朝起きて昨夜の発作を書く」= 現象の時刻と記録の時刻は別）
//   - Markdown 書き出しでただのテーブルとして残る（医師に見せる等の可搬性）

import { formatDateTime } from "../../lib/format-datetime";

/** セルの形式（tableCell / 旧 inline 配列）を保ったままテキストだけのセルを作る */
function makeCell(template: any, text: string): any {
  const content = [{ type: "text", text, styles: {} }];
  if (template && !Array.isArray(template) && template.type === "tableCell") {
    // 結合セル等の属性は引き継がず、素のセルにする
    return { type: "tableCell", content, props: {} };
  }
  return content;
}

/** ドキュメントツリーから blockId のテーブルブロックを探す */
export function findTableBlock(editor: any, tableBlockId: string): any | null {
  let found: any = null;
  const visit = (blocks: any[]) => {
    for (const b of blocks ?? []) {
      if (found) return;
      if (b?.id === tableBlockId) {
        found = b;
        return;
      }
      if (Array.isArray(b?.children)) visit(b.children);
    }
  };
  visit(editor?.document ?? []);
  return found && found.type === "table" ? found : null;
}

/**
 * 記録テーブルの末尾に「1 列目 = 現在日時、残り = 空」の行を足す。
 * 追加できたら true。
 */
export function addRecordRow(editor: any, tableBlockId: string, now: Date = new Date()): boolean {
  const block = findTableBlock(editor, tableBlockId);
  if (!block) return false;
  const rows: any[] = block.content?.rows ?? [];
  if (rows.length === 0) return false;
  const colCount = rows[0].cells?.length ?? 0;
  if (colCount === 0) return false;
  const template = rows[1]?.cells?.[0] ?? rows[0].cells[0];
  const cells = Array.from({ length: colCount }, (_, j) =>
    makeCell(template, j === 0 ? formatDateTime(now) : "")
  );
  try {
    editor.updateBlock(block.id, {
      content: { ...block.content, rows: [...rows, { cells }] },
    });
    return true;
  } catch {
    return false;
  }
}
