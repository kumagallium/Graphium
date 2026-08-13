// 記録テーブルの自動日時記入
//
// 専用の「+ 記録」ボタンは持たない。記録テーブルは「行を足すと 1 列目に
// 日時が入るふるまいがオンになった、ただのテーブル」であり、行の追加は
// BlockNote 標準の操作（テーブル下端の + 帯・最終セルで Tab・右クリック・
// ペースト）をそのまま使う。ここは editor.onChange 経由で行数の増加を検知し、
// 1 列目が空の行に現在日時を書き込むだけの薄いレイヤー。
//
// - ノートを開いた直後（初見）は記録だけ行い、既存の空セルには書き込まない
// - 行数が減った・変わらないときは何もしない（undo を邪魔しない）
// - 書き込みは editor.updateBlock なので再び onChange が走るが、その回は
//   行数が変わらないため何もせず収束する

import { formatDateTime } from "../../lib/format-datetime";
import { readCellText } from "../table-meta/table-cells";

/** セルの形式（tableCell / 旧 inline 配列）を保ったままテキストだけのセルを作る */
function withCellText(cell: any, text: string): any {
  const content = [{ type: "text", text, styles: {} }];
  if (cell && !Array.isArray(cell) && cell.type === "tableCell") {
    return { ...cell, content };
  }
  return content;
}

// テーブルブロック ID → 直近に見た行数（ヘッダ込み）
const prevRowCounts = new Map<string, number>();

/** ノート切替時に呼ぶ。前のノートの行数記録を捨て、次のノートで「初見」から始める */
export function resetLogTableRowTracking(): void {
  prevRowCounts.clear();
}

/**
 * ノート読込時に、保存済みブロックから各記録テーブルの行数を先に記録しておく。
 * これが無いと「ノートを開いて最初の行追加」が初見扱いになり日時が入らない
 * （初見で書き込まないのは、既存の空セルを勝手に埋めないための仕様）。
 */
export function primeLogTableRowTracking(blocks: any[], logTableIds: Iterable<string>): void {
  prevRowCounts.clear();
  const ids = new Set(logTableIds);
  if (ids.size === 0) return;
  const visit = (list: any[]) => {
    for (const b of list ?? []) {
      if (b?.type === "table" && ids.has(b.id)) {
        prevRowCounts.set(b.id, (b.content?.rows ?? []).length);
      }
      if (Array.isArray(b?.children)) visit(b.children);
    }
  };
  visit(blocks ?? []);
}

/**
 * 登録済み記録テーブルの行数変化を調べ、増えていれば 1 列目が空の
 * データ行に現在日時を書き込む。editor.onChange から毎回呼んでよい。
 */
export function applyLogTableTimestamps(
  editor: any,
  logTableIds: Iterable<string>,
  now: Date = new Date()
): void {
  for (const blockId of logTableIds) {
    const block = editor?.getBlock?.(blockId);
    if (!block || block.type !== "table") {
      prevRowCounts.delete(blockId);
      continue;
    }
    const rows: any[] = block.content?.rows ?? [];
    const prev = prevRowCounts.get(blockId);
    prevRowCounts.set(blockId, rows.length);
    // 初見は記録のみ。減少・不変は何もしない
    if (prev === undefined || rows.length <= prev) continue;

    const stamp = formatDateTime(now);
    let changed = false;
    const nextRows = rows.map((row, i) => {
      if (i === 0) return row; // ヘッダ
      const cells = row.cells ?? [];
      if (cells.length === 0 || readCellText(cells[0]) !== "") return row;
      changed = true;
      return {
        ...row,
        cells: cells.map((c: any, j: number) => (j === 0 ? withCellText(c, stamp) : c)),
      };
    });
    if (!changed) continue;
    try {
      editor.updateBlock(block.id, { content: { ...block.content, rows: nextRows } });
    } catch {
      // 走査中のトランザクション競合などで失敗しても、次の onChange で再試行される
    }
  }
}
