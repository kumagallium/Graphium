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

export type DataPreview = {
  /** 見出し（列名） */
  headers: string[];
  /** データ行数 */
  rowCount: number;
  /** 数値として読める列の名前 */
  numericColumns: string[];
  /** 線の形（x 昇順。最大 SPARKLINE_BUCKETS * 2 点に間引いた値） */
  sparkline: SparkPoint[];
  /** 数値列があり、チャートにできるか */
  usable: boolean;
};

/** 下見の線の横方向の区間数（区間ごとに y の最小・最大の 2 点まで残す） */
export const SPARKLINE_BUCKETS = 48;
const SPARKLINE_MAX_POINTS = SPARKLINE_BUCKETS * 2;

/** 下見の判定に使う本文の上限（列の判定はこの範囲だけ。UI を止めないため） */
export const PREVIEW_MAX_CHARS = 256 * 1024;

/** 全文走査でこの行数ごとに UI へ制御を返す */
const YIELD_EVERY_ROWS = 20000;

/**
 * 点列を x 昇順にし、96 点を超えるなら x 範囲を 48 区間に等分して
 * 区間ごとの y の最小・最大の点だけ残す（点の間の鋭いピークを落とさない）。
 * xs / ys は行順。同じ x は行順を保つ。
 */
function reduceToSparkline(xs: number[], ys: number[]): SparkPoint[] {
  const n = xs.length;
  if (n === 0) return [];
  const picked: number[] = [];
  if (n <= SPARKLINE_MAX_POINTS) {
    for (let i = 0; i < n; i++) picked.push(i);
  } else {
    let xMin = Infinity;
    let xMax = -Infinity;
    for (let i = 0; i < n; i++) {
      if (xs[i] < xMin) xMin = xs[i];
      if (xs[i] > xMax) xMax = xs[i];
    }
    const span = xMax - xMin;
    const lo = new Array<number>(SPARKLINE_BUCKETS).fill(-1);
    const hi = new Array<number>(SPARKLINE_BUCKETS).fill(-1);
    for (let i = 0; i < n; i++) {
      const b =
        span > 0
          ? Math.min(
              SPARKLINE_BUCKETS - 1,
              Math.floor(((xs[i] - xMin) / span) * SPARKLINE_BUCKETS)
            )
          : 0;
      // 同値は先に出た行を残す
      if (lo[b] < 0 || ys[i] < ys[lo[b]]) lo[b] = i;
      if (hi[b] < 0 || ys[i] > ys[hi[b]]) hi[b] = i;
    }
    for (let b = 0; b < SPARKLINE_BUCKETS; b++) {
      if (lo[b] < 0) continue;
      if (lo[b] === hi[b]) picked.push(lo[b]);
      else picked.push(Math.min(lo[b], hi[b]), Math.max(lo[b], hi[b]));
    }
  }
  // x 昇順に並べる（同じ x は行順）
  picked.sort((a, b) => xs[a] - xs[b] || a - b);
  return picked.map((i) => ({ x: xs[i], y: ys[i] }));
}

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
  /** 線にする列（無ければ -1） */
  yIdx: number;
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

  // 線にする列: 先頭列（X 想定）以外の最初の数値列。無ければ最初の数値列
  const lineColumn =
    numericColumns.find((c) => c !== headers[0]) ?? numericColumns[0];
  const yIdx = lineColumn !== undefined ? headers.indexOf(lineColumn) : -1;
  // 先頭列が線の列と別で、空でないセルの過半が数値か日時として読めれば X にする。
  // 読めない列（ラベル等）なら全点を行番号で並べる。1 つの線に X の値と行番号を
  // 混ぜると、値の範囲（例: 10〜80）の外に点が飛ぶため
  let xIdx = -1;
  if (yIdx > 0) {
    const cells = table.rows.map((r) => r[0] ?? "").filter((c) => c.trim() !== "");
    const readable = cells.filter((c) => readX(c) !== null).length;
    if (cells.length > 0 && readable >= cells.length / 2) xIdx = 0;
  }
  return {
    headers,
    numericColumns,
    usable: numericColumns.length > 0,
    table,
    options,
    yIdx,
    xIdx,
    big,
    body,
  };
}

function finish(h: Head, sparkline: SparkPoint[], rowCount: number): DataPreview {
  return {
    headers: h.headers,
    rowCount,
    numericColumns: h.numericColumns,
    sparkline,
    usable: h.usable,
  };
}

/** 先頭 256 KB に収まる本文: 表の行から線を作る */
function previewSmall(h: Head): DataPreview {
  const xs: number[] = [];
  const ys: number[] = [];
  if (h.yIdx >= 0) {
    h.table.rows.forEach((row, i) => {
      const y = parseNumeric(row[h.yIdx] ?? "");
      if (y === null) return;
      // X 列を使うときは、X が読めない行を線に入れない（行番号と混ぜない）
      const x = h.xIdx >= 0 ? readX(row[h.xIdx] ?? "") : i;
      if (x === null) return;
      xs.push(x);
      ys.push(y);
    });
  }
  return finish(h, reduceToSparkline(xs, ys), h.table.rows.length);
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

/** 全文走査の途中経過（行順の点列と空でない行数） */
type Scan = { xs: number[]; ys: number[]; rowCount: number };

/** 全文走査で 1 行を取り込む関数を作る（x 列と y 列だけ読む） */
function makeLineFeeder(h: Head, scan: Scan): (line: string) => void {
  const delimiter = resolveDelimiter(h.options);
  const collapse = h.options.collapseConsecutive;
  return (rawLine) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.trim() === "") return;
    const rowNo = scan.rowCount++;
    if (delimiter === null || h.yIdx < 0) return;
    const cells = splitLine(line, delimiter, collapse);
    const y = parseNumeric(cells[h.yIdx] ?? "");
    if (y === null) return;
    const x = h.xIdx >= 0 ? readX(cells[h.xIdx] ?? "") : rowNo;
    if (x === null) return;
    scan.xs.push(x);
    scan.ys.push(y);
  };
}

/**
 * 本文全体を 1 行ずつ読む。全文の split はしない。
 * YIELD_EVERY_ROWS 行ごとに yield する（非同期版がここで制御を返す）。
 */
function scanBody(h: Head, scan: Scan): Generator<void, void, void> {
  const feed = makeLineFeeder(h, scan);
  const body = h.body;
  return (function* () {
    let pos = bodyStartOffset(body, h.options.headerRow);
    if (pos < 0) return;
    let sinceYield = 0;
    while (pos <= body.length) {
      const nl = body.indexOf("\n", pos);
      feed(body.slice(pos, nl === -1 ? body.length : nl));
      if (nl === -1) break;
      pos = nl + 1;
      if (++sinceYield >= YIELD_EVERY_ROWS) {
        sinceYield = 0;
        yield;
      }
    }
  })();
}

export function analyzeDataText(fullText: string): DataPreview {
  const h = analyzeHead(fullText);
  if (!h.big) return previewSmall(h);
  const scan: Scan = { xs: [], ys: [], rowCount: 0 };
  for (const _ of scanBody(h, scan)) void _;
  return finish(h, reduceToSparkline(scan.xs, scan.ys), scan.rowCount);
}

/** analyzeDataText の非同期版。全文走査を 20,000 行ごとに区切って UI を止めない */
export async function analyzeDataTextAsync(fullText: string): Promise<DataPreview> {
  const h = analyzeHead(fullText);
  if (!h.big) return previewSmall(h);
  const scan: Scan = { xs: [], ys: [], rowCount: 0 };
  for (const _ of scanBody(h, scan)) {
    void _;
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  return finish(h, reduceToSparkline(scan.xs, scan.ys), scan.rowCount);
}
