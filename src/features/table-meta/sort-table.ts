// テーブルの並べ替え
//
// 比較ロジックはここに 1 本化し、2 つの入口から使う:
// - 拡大ビュー / データ素材プレビューの表示（expand-modal.tsx が re-export）
// - 実テーブルの並べ替え（sortTableBlock — 列ハンドルメニュー・拡大ビューから）
//
// 実テーブルの並べ替えは**ふつうの編集**として扱う: updateBlock で行を
// 入れ替えるだけなので Undo で戻せる。ソート状態は保存しない — 並べ替えた
// 結果の行順だけが実体で、データに痕跡を残さない。

import { parseNumeric } from "../../blocks/chart/chart-data";
import { readCellText } from "./table-cells";

export type SortDir = "asc" | "desc";
export type SortState = { col: number; dir: SortDir } | null;

/**
 * 列を数値として並べ替えるべきか。非空セルの過半が数値として読めれば数値列とみなす。
 * （チャートの列判定と同じ「推定」の考え方。型を宣言させない）
 */
export function isNumericColumn(rows: string[][], col: number): boolean {
  let filled = 0;
  let numeric = 0;
  for (const row of rows) {
    const v = (row[col] ?? "").trim();
    if (v === "") continue;
    filled++;
    if (parseNumeric(v) !== null) numeric++;
  }
  return filled > 0 && numeric * 2 > filled;
}

/**
 * 並べ替え後の行順（元 index の並び）を返す。
 * 数値列: 読めない値・空セルは常に末尾。文字列列: locale 比較、空セルは末尾。
 * 同値のときは元の並びを保つ（安定）。
 */
export function sortRowOrder(rows: string[][], sort: NonNullable<SortState>): number[] {
  const { col, dir } = sort;
  const sign = dir === "asc" ? 1 : -1;
  const numeric = isNumericColumn(rows, col);
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const va = (a.row[col] ?? "").trim();
      const vb = (b.row[col] ?? "").trim();
      if (va === "" && vb === "") return a.i - b.i;
      if (va === "") return 1;
      if (vb === "") return -1;
      if (numeric) {
        const na = parseNumeric(va);
        const nb = parseNumeric(vb);
        if (na === null && nb === null) return a.i - b.i;
        if (na === null) return 1;
        if (nb === null) return -1;
        return na === nb ? a.i - b.i : (na - nb) * sign;
      }
      const c = va.localeCompare(vb, undefined, { numeric: true });
      return c === 0 ? a.i - b.i : c * sign;
    })
    .map((x) => x.i);
}

/** 行を並べ替えて返す（元配列は変えない）。表示用。 */
export function sortRows(rows: string[][], sort: SortState): string[][] {
  if (!sort) return rows;
  return sortRowOrder(rows, sort).map((i) => rows[i]);
}

/**
 * 実テーブル（ノート上の table ブロック）を列で並べ替える。
 * - 1 行目はヘッダとして固定し、データ行だけを入れ替える
 * - 行は cells ごと移動するので、行 ID（tableRowIdentity スタイル）や
 *   セル内のインライン装飾は行と一緒に付いてくる
 * - columnWidths / headerRows 等の content プロパティは保持する
 */
export function sortTableBlock(
  editor: any,
  blockId: string,
  col: number,
  dir: SortDir
): void {
  const block = editor?.getBlock?.(blockId);
  if (!block || block.type !== "table") return;
  const content = block.content ?? {};
  const rawRows: any[] = content.rows ?? [];
  if (rawRows.length < 3) return; // ヘッダ + 1 行以下は並べ替えても変わらない
  const [header, ...dataRows] = rawRows;
  const texts = dataRows.map((r: any) => (r?.cells ?? []).map((c: any) => readCellText(c)));
  const order = sortRowOrder(texts, { col, dir });
  // 既に同じ並びなら何もしない（無駄な編集履歴・保存を作らない）
  if (order.every((v, i) => v === i)) return;
  editor.updateBlock(blockId, {
    content: { ...content, type: "tableContent", rows: [header, ...order.map((i) => dataRows[i])] },
  });
}
