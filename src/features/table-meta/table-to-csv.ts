// 表 → CSV（純ロジック）
//
// 本文の表をデータ素材にするとき、またデータ表を計算列込みで書き出すときの
// 共通部分。RFC 4180 に沿って、区切り・引用符・改行を含むセルだけ引用符で囲む。

import { readCellText } from "./table-cells";

/** セルを CSV の 1 フィールドに */
export function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** 見出しと本文を CSV テキストに（末尾に改行なし） */
export function rowsToCsv(headers: string[], rows: string[][]): string {
  const width = headers.length;
  const line = (cells: string[]) =>
    Array.from({ length: width }, (_, i) => csvEscape(cells[i] ?? "")).join(",");
  return [line(headers), ...rows.map(line)].join("\n");
}

/** 本文の表ブロック（1 行目が見出し）を見出しと本文のテキストに読む。表でなければ null */
export function noteTableToRows(block: any): { headers: string[]; rows: string[][] } | null {
  if (!block || block.type !== "table") return null;
  const rows: any[] = block.content?.rows ?? [];
  if (rows.length < 1) return null;
  const headers: string[] = (rows[0].cells ?? []).map((c: any) => readCellText(c));
  const body: string[][] = rows
    .slice(1)
    .map((r: any) => (r.cells ?? []).map((c: any) => readCellText(c)));
  return { headers, rows: body };
}

/** 表の名前からファイル名を作る（拡張子は .csv、ファイル名に使えない文字は置き換える） */
export function csvFileNameFor(caption: string, fallback: string): string {
  const base = (caption.trim() || fallback).replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
  return `${base || fallback}.csv`;
}

/**
 * 見出しと行が同じ中身かどうか。素材を作り直さずに済むかの判定に使う。
 *
 * 行の長さの違いは空セルの有無として扱う（素材の CSV は末尾の空セルを落とすことが
 * あり、本文の表は見出しの数だけセルを持つ）。中身が違えば false を返し、
 * 呼び出し側は新しい素材を作る — 迷ったら作り直す側に倒す。
 */
export function sameTableContent(
  a: { headers: string[]; rows: string[][] } | null | undefined,
  b: { headers: string[]; rows: string[][] } | null | undefined,
): boolean {
  if (!a || !b) return false;
  const width = Math.max(a.headers.length, b.headers.length);
  const cell = (row: string[] | undefined, i: number) => row?.[i] ?? "";
  for (let i = 0; i < width; i++) {
    if (cell(a.headers, i) !== cell(b.headers, i)) return false;
  }
  if (a.rows.length !== b.rows.length) return false;
  for (let r = 0; r < a.rows.length; r++) {
    for (let i = 0; i < width; i++) {
      if (cell(a.rows[r], i) !== cell(b.rows[r], i)) return false;
    }
  }
  return true;
}
