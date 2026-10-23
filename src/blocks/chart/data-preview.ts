// データピッカー用の中身の下見（純関数）
//
// 素材の本文を取り込みダイアログと同じ規則（行分割 → 読み方の自動判定 → 区切り読み）で
// 表にし、「グラフにできるか」「何の列があるか」「どんな形の線か」だけを返す。
// キャッシュは持たない（ピッカー側が fileId 単位で持つ）。

import {
  splitLines,
  splitLine,
  parseDelimited,
  resolveDelimiter,
} from "../../features/data-import/parse";
import { detectImportOptions } from "../../features/data-import/detect";
import type { DelimitedImportOptions } from "../../features/data-import/types";
import {
  isNumericColumn,
  parseNumeric,
  parseDateTime,
  type TableData,
} from "./chart-data";

/** 線の 1 点（x は横の位置、y は値。正規化は描画側） */
export type SparkPoint = { x: number; y: number };

/** 線 1 本（数値列 1 列ぶん） */
export type SparkSeries = { column: string; points: SparkPoint[] };

export type DataPreview = {
  /** 見出し（列名） */
  headers: string[];
  /** データ行数 */
  rowCount: number;
  /** 数値として読める列の名前 */
  numericColumns: string[];
  /** 線の形（列ごと。points は x 昇順で、最大 SPARKLINE_BUCKETS * 2 点に間引いた値） */
  sparkline: SparkSeries[];
  /** 数値列があり、チャートにできるか */
  usable: boolean;
};

/** 下見の線の横方向の区間数（区間ごとに y の最小・最大の 2 点まで残す） */
export const SPARKLINE_BUCKETS = 48;
const SPARKLINE_MAX_POINTS = SPARKLINE_BUCKETS * 2;

/** 下見で重ねる線の最大本数（X 列を除く数値列の先頭から） */
export const SPARKLINE_MAX_SERIES = 4;

/** 下見の判定に使う本文の上限（列の判定はこの範囲だけ。UI を止めないため） */
export const PREVIEW_MAX_CHARS = 256 * 1024;

/** 全文走査でこの行数ごとに UI へ制御を返す */
const YIELD_EVERY_ROWS = 20000;

/**
 * X のセルを読む。数値 → 日時の順だが、"2026-10-01" の先頭 4 桁を数値と取り違えないよう、
 * 全体が数値のセルだけを先に数値とし、次に日時、最後に単位付きなどの先頭数値を試す。
 */
function readX(cell: string): number | null {
  const t = cell.trim();
  if (t !== "" && Number.isFinite(Number(t))) return Number(t);
  return parseDateTime(cell) ?? parseNumeric(cell);
}


/** 先頭 256 KB で決まる、列の判定と読み方 */
type Head = {
  headers: string[];
  numericColumns: string[];
  usable: boolean;
  table: TableData;
  options: DelimitedImportOptions;
  /** 線にする列の位置（最大 SPARKLINE_MAX_SERIES 本。無ければ空） */
  yIdxs: number[];
  /** X にする列（線の列と別の先頭列で、過半が読める。無ければ -1 = 行番号） */
  xIdx: number;
  /** 本文全体が判定範囲を超えているか */
  big: boolean;
  /** BOM を除いた本文全体 */
  body: string;
};

function analyzeHead(fullText: string): Head {
  const body = fullText.replace(/^﻿/, "");
  const big = body.length > PREVIEW_MAX_CHARS;
  let text = body;
  if (big) {
    // 巨大ファイルの判定は先頭だけで行う（最後の改行で切る）
    const cut = body.lastIndexOf("\n", PREVIEW_MAX_CHARS);
    text = body.slice(0, cut > 0 ? cut : PREVIEW_MAX_CHARS);
  }
  const lines = splitLines(text);
  const options = detectImportOptions(lines);
  const parsed = parseDelimited(text, options);
  const table: TableData = { headers: parsed.headers, rows: parsed.rows };
  const headers = table.headers;

  // 空の見出しは列として扱わない
  const numericColumns = headers.filter(
    (h) => h.trim() !== "" && isNumericColumn(table, h)
  );

  // 先頭列（X 想定）以外に数値列があり、先頭列の空でないセルの過半が数値か日時として
  // 読めれば X にする。読めない列（ラベル等）なら全点を行番号で並べる。
  // 1 つの線に X の値と行番号を混ぜると、値の範囲（例: 10〜80）の外に点が飛ぶため
  let xIdx = -1;
  if (numericColumns.some((c) => c !== headers[0])) {
    const cells = table.rows.map((r) => r[0] ?? "").filter((c) => c.trim() !== "");
    const readable = cells.filter((c) => readX(c) !== null).length;
    if (cells.length > 0 && readable >= cells.length / 2) xIdx = 0;
  }
  // 線にする列: X を使うときは先頭列以外の数値列（chart-config の suggestSeries と同じ順）、
  // 使わないときは数値列の先頭から
  const lineColumns = (
    xIdx >= 0 ? numericColumns.filter((c) => c !== headers[0]) : numericColumns
  ).slice(0, SPARKLINE_MAX_SERIES);
  const yIdxs = lineColumns.map((c) => headers.indexOf(c));
  return {
    headers,
    numericColumns,
    usable: numericColumns.length > 0,
    table,
    options,
    yIdxs,
    xIdx,
    big,
    body,
  };
}

/** 見出し行の次の行の先頭位置（見つからなければ -1） */
function bodyStartOffset(body: string, headerRow: number): number {
  const re = /\r\n|\r|\n/g;
  const headerIdx = Math.max(0, headerRow - 1);
  let m: RegExpExecArray | null = null;
  for (let i = 0; i <= headerIdx; i++) {
    m = re.exec(body);
    if (!m) return -1;
  }
  return m ? m.index + m[0].length : -1;
}

/**
 * データ行のセル配列を順に返す。null は「ここで UI に制御を返してよい」の合図。
 * 小さい本文は表の行から、大きい本文は全文を 1 行ずつ読む（全文の split はしない）。
 * 区切りが決まらない大きい本文は、行数だけ数えられるよう空の配列を返す。
 */
function* iterRows(h: Head): Generator<string[] | null, void, void> {
  if (!h.big) {
    for (const row of h.table.rows) yield row;
    return;
  }
  const body = h.body;
  const delimiter = resolveDelimiter(h.options);
  const collapse = h.options.collapseConsecutive;
  let pos = bodyStartOffset(body, h.options.headerRow);
  if (pos < 0) return;
  let sinceYield = 0;
  while (pos <= body.length) {
    const nl = body.indexOf("\n", pos);
    const raw = body.slice(pos, nl === -1 ? body.length : nl);
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.trim() !== "") yield delimiter === null ? [] : splitLine(line, delimiter, collapse);
    if (nl === -1) break;
    pos = nl + 1;
    if (++sinceYield >= YIELD_EVERY_ROWS) {
      sinceYield = 0;
      yield null;
    }
  }
}

/** 1 行から x と各線の y を読む（x が読めない行は null。y は読めない列だけ null） */
function readRow(
  h: Head,
  cells: string[],
  rowNo: number
): { x: number; ys: Array<number | null> } | null {
  // X 列を使うときは、X が読めない行を線に入れない（行番号と混ぜない）
  const x = h.xIdx >= 0 ? readX(cells[h.xIdx] ?? "") : rowNo;
  if (x === null) return null;
  return { x, ys: h.yIdxs.map((i) => parseNumeric(cells[i] ?? "")) };
}

/** 区間ごとの最小・最大の点（i は行順。同値は先に出た行を残す） */
type Cell = { x: number; y: number; i: number };
type Extremes = { lo: Cell | null; hi: Cell | null };

/**
 * 2 回の走査で線を作る。点の配列を行数に比例して持たない。
 * 1 回目: 行数・X の範囲・列ごとの有効な点の数だけ測る。
 * 2 回目: 点が 96 以下の列はそのまま、超える列は 48 区間（全列共通の X 範囲）ごとに
 * 最小・最大の点だけ持つ。
 */
function* buildPreview(h: Head): Generator<void, DataPreview, void> {
  const nCols = h.yIdxs.length;
  // 1 回目
  let rowCount = 0;
  let xMin = Infinity;
  let xMax = -Infinity;
  const valid = new Array<number>(nCols).fill(0);
  for (const cells of iterRows(h)) {
    if (cells === null) {
      yield;
      continue;
    }
    const rowNo = rowCount++;
    if (nCols === 0) continue;
    const r = readRow(h, cells, rowNo);
    if (!r) continue;
    let any = false;
    r.ys.forEach((y, c) => {
      if (y === null) return;
      valid[c]++;
      any = true;
    });
    if (any) {
      if (r.x < xMin) xMin = r.x;
      if (r.x > xMax) xMax = r.x;
    }
  }
  const finish = (sparkline: SparkSeries[]): DataPreview => ({
    headers: h.headers,
    rowCount,
    numericColumns: h.numericColumns,
    sparkline,
    usable: h.usable,
  });
  if (nCols === 0) return finish([]);

  // 2 回目
  const span = xMax - xMin;
  const raw: Cell[][] = h.yIdxs.map(() => []);
  const buckets: Extremes[][] = h.yIdxs.map((_, c) =>
    valid[c] > SPARKLINE_MAX_POINTS
      ? Array.from({ length: SPARKLINE_BUCKETS }, () => ({ lo: null, hi: null }))
      : []
  );
  let rowNo = 0;
  for (const cells of iterRows(h)) {
    if (cells === null) {
      yield;
      continue;
    }
    const i = rowNo++;
    const r = readRow(h, cells, i);
    if (!r) continue;
    r.ys.forEach((y, c) => {
      if (y === null) return;
      const cell: Cell = { x: r.x, y, i };
      if (valid[c] <= SPARKLINE_MAX_POINTS) {
        raw[c].push(cell);
        return;
      }
      const b =
        span > 0
          ? Math.min(SPARKLINE_BUCKETS - 1, Math.floor(((r.x - xMin) / span) * SPARKLINE_BUCKETS))
          : 0;
      const e = buckets[c][b];
      // 同値は先に出た行を残す
      if (e.lo === null || y < e.lo.y) e.lo = cell;
      if (e.hi === null || y > e.hi.y) e.hi = cell;
    });
  }

  const sparkline = h.yIdxs.map((idx, c): SparkSeries => {
    let picked: Cell[];
    if (valid[c] <= SPARKLINE_MAX_POINTS) {
      picked = raw[c];
    } else {
      picked = [];
      for (const e of buckets[c]) {
        if (!e.lo || !e.hi) continue;
        if (e.lo.i === e.hi.i) picked.push(e.lo);
        else picked.push(...(e.lo.i < e.hi.i ? [e.lo, e.hi] : [e.hi, e.lo]));
      }
    }
    // x 昇順に並べる（同じ x は行順）
    picked.sort((a, b) => a.x - b.x || a.i - b.i);
    return { column: h.headers[idx], points: picked.map((p) => ({ x: p.x, y: p.y })) };
  });
  return finish(sparkline);
}

export function analyzeDataText(fullText: string): DataPreview {
  const gen = buildPreview(analyzeHead(fullText));
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
  }
}

/** analyzeDataText の非同期版。全文走査を 20,000 行ごとに区切って UI を止めない */
export async function analyzeDataTextAsync(fullText: string): Promise<DataPreview> {
  const gen = buildPreview(analyzeHead(fullText));
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
    await new Promise<void>((res) => setTimeout(res, 0));
  }
}
