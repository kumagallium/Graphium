// 計算ブロックが書いたセルの割り出し
//
// 計算の書き戻し（blocks/calc/writeback.ts）は列単位で宣言されるが、実際に値が入るのは
// 列のうち一部のセルになる: 結果が空の行と、式が cell() で読んでいる行（基準行）は書かない。
// 表の上でどのセルが計算の値でどのセルが人の書いた値かを見分けられるよう、
// 書く側（applyCalcWritebacks）と印を付ける側（caption-layer）が同じ判定をここで共有する。
// calc → table-meta の依存の向きを保つため、calc の型は持ち込まず最小の形で受ける。

import { readCellText } from "./table-cells";

/** 書き戻し 1 件のうち、セルの判定に要る部分 */
export type CalcCellWrite = {
  tableBlockId: string;
  column: string;
  /** データ行（2 行目以降）へ上から順に入れる文字列 */
  texts: string[];
  /** 書かない行の名前（表の 1 列目の文字）。式が cell() で読んでいる行 */
  skipRows?: string[];
};

/**
 * 書かない行の位置（rows の添字。0 はヘッダ）。cell() と同じく、同じ名前の行が
 * 2 つあれば上の行だけ（式が読んでいるのはそちら）
 */
export function skippedRowIndexes(rows: any[], skipRows: string[] | undefined): Set<number> {
  const out = new Set<number>();
  if (!skipRows || skipRows.length === 0) return out;
  const wanted = new Set(skipRows.map((name) => name.trim()));
  for (let r = 1; r < rows.length; r += 1) {
    const name = readCellText(rows[r]?.cells?.[0]).trim();
    if (wanted.has(name)) {
      out.add(r);
      wanted.delete(name);
    }
  }
  return out;
}

/** ヘッダ行から列の位置を探す。無ければ -1 */
export function columnIndexOf(rows: any[], column: string): number {
  const headers: string[] = (rows[0]?.cells ?? []).map((c: any) => readCellText(c));
  return headers.findIndex((h) => h.trim() === column);
}

/**
 * この表で計算が値を入れるセルの位置（row は rows の添字で 1 以上、col は列の添字）。
 * 空の結果・書かない行・形の崩れた行は含めない
 */
export function calcWrittenCells(
  block: any,
  requests: CalcCellWrite[],
): { row: number; col: number }[] {
  const rows: any[] = block?.content?.rows ?? [];
  if (rows.length < 2) return [];
  const out: { row: number; col: number }[] = [];
  for (const req of requests) {
    if (req.tableBlockId !== block.id) continue;
    const col = columnIndexOf(rows, req.column);
    if (col < 0) continue;
    const skipped = skippedRowIndexes(rows, req.skipRows);
    for (let r = 1; r < rows.length; r += 1) {
      if (skipped.has(r)) continue;
      if (col >= (rows[r]?.cells?.length ?? 0)) continue;
      if ((req.texts[r - 1] ?? "").trim() === "") continue;
      out.push({ row: r, col });
    }
  }
  return out;
}
