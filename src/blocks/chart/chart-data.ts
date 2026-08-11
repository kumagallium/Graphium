// チャートブロックのデータ変換（純関数のみ）
//
// 「テーブルの行列 → チャートに描ける系列」の変換をここに閉じ込める。
// エディタにも ECharts にも依存しないため単体テストでき、将来データソースを
// 増やす（CSV・集計エンジン等に差し替える）ときもこの境界だけ差し替えれば済む。
//
// 値はすべて文字列で届く（BlockNote のテーブルセルはリッチテキスト）。
// - 数値: "6", "36.5", "1,200"（桁区切り・全角数字も許容）
// - 日時: format-datetime.ts の "YYYY-MM-DD HH:MM" と "YYYY-MM-DD" を第一に、
//   Date.parse が読める形式も受ける
// - 空セル・読めない値は欠測としてスキップする（0 に化けさせない）

export type TableData = {
  /** ヘッダ行のセルテキスト */
  headers: string[];
  /** データ行（ヘッダを除く）のセルテキスト */
  rows: string[][];
};

export type ChartType = "line" | "bar" | "scatter" | "histogram";

export type ChartConfig = {
  chartType: ChartType;
  /** X 軸に使う列名（histogram では対象の数値列） */
  xColumn: string;
  /** 系列にする列名（カンマ区切りで props に保存されるため配列で受ける） */
  yColumns: string[];
};

export type XAxisKind = "time" | "value" | "category";

export type ChartSeries = {
  name: string;
  /** time/value 軸: [x, y] のペア。category 軸: y のみ（x はカテゴリ順） */
  points: Array<[number, number]> | Array<number | null>;
};

export type ChartDataResult =
  | {
      kind: "ok";
      xAxis: XAxisKind;
      /** category 軸のときの X ラベル列 */
      categories: string[];
      series: ChartSeries[];
    }
  | { kind: "empty" }
  | { kind: "no-numeric-series" };

/** 全角数字・桁区切り・単位の混じったセルから数値を取り出す。読めなければ null */
export function parseNumeric(raw: string): number | null {
  const s = raw
    .trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/，/g, ",")
    .replace(/．/g, ".")
    .replace(/[−ー]/g, "-")
    .replace(/,/g, "");
  if (!s) return null;
  // 先頭の数値部分だけを読む（"6/10" や "36.5℃" を許容）
  const m = s.match(/^[+-]?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** セルを日時として読む。読めなければ null（epoch ms を返す） */
export function parseDateTime(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  // "YYYY-MM-DD HH:MM"（format-datetime.ts の形式）はローカル時刻として読む
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const d = new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4] ?? 0),
      Number(m[5] ?? 0),
      Number(m[6] ?? 0)
    );
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  // 素の数値（"1", "36.5"）を Date.parse が年として読んでしまうのを防ぐ:
  // 日付らしい区切りを含むときだけフォールバックを試す
  if (!/[-/:]/.test(s)) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function columnIndex(headers: string[], name: string): number {
  return headers.findIndex((h) => h.trim() === name.trim());
}

/** 列の値の過半が日時として読めれば time、数値なら value、それ以外は category */
export function detectXAxisKind(values: string[]): XAxisKind {
  const nonEmpty = values.filter((v) => v.trim() !== "");
  if (nonEmpty.length === 0) return "category";
  const dateCount = nonEmpty.filter((v) => parseDateTime(v) !== null).length;
  if (dateCount >= nonEmpty.length / 2) return "time";
  const numCount = nonEmpty.filter((v) => parseNumeric(v) !== null).length;
  if (numCount >= nonEmpty.length / 2) return "value";
  return "category";
}

/** 列が数値列として使えるか（非空セルの過半が数値として読める） */
export function isNumericColumn(table: TableData, name: string): boolean {
  const idx = columnIndex(table.headers, name);
  if (idx < 0) return false;
  const values = table.rows.map((r) => r[idx] ?? "").filter((v) => v.trim() !== "");
  if (values.length === 0) return false;
  return values.filter((v) => parseNumeric(v) !== null).length >= values.length / 2;
}

/** 設定が未指定のときの初期推定: X = 最初の列、系列 = それ以外の数値列 */
export function suggestConfig(table: TableData): Pick<ChartConfig, "xColumn" | "yColumns"> {
  const xColumn = table.headers[0] ?? "";
  const yColumns = table.headers
    .slice(1)
    .filter((h) => h.trim() !== "" && isNumericColumn(table, h));
  return { xColumn, yColumns };
}

/** ヒストグラムのビン分割（Sturges の公式ベース、キリの良い幅に丸める） */
export function buildHistogram(values: number[]): { labels: string[]; counts: number[] } {
  if (values.length === 0) return { labels: [], counts: [] };
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return { labels: [String(min)], counts: [values.length] };
  }
  const binCount = Math.max(1, Math.ceil(Math.log2(values.length) + 1));
  const rawWidth = (max - min) / binCount;
  // 1/2/5 × 10^n に丸めて境界を読みやすくする
  const pow = Math.pow(10, Math.floor(Math.log10(rawWidth)));
  const width = [1, 2, 5, 10].map((f) => f * pow).find((w) => w >= rawWidth) ?? rawWidth;
  const start = Math.floor(min / width) * width;
  const bins = Math.max(1, Math.ceil((max - start) / width + 1e-9));
  const counts = new Array(bins).fill(0);
  for (const v of values) {
    const i = Math.min(bins - 1, Math.floor((v - start) / width));
    counts[i]++;
  }
  const fmt = (n: number) => {
    const rounded = Math.round(n * 1e6) / 1e6;
    return String(rounded);
  };
  const labels = counts.map((_, i) => `${fmt(start + i * width)}–${fmt(start + (i + 1) * width)}`);
  return { labels, counts };
}

/**
 * テーブル + 設定 → 描画可能な系列。
 * ここが「集計層」の境界: 将来 CSV や外部エンジンに差し替えるときは
 * この関数と同じ出力を返す実装を用意すればよい。
 */
export function buildChartData(table: TableData, config: ChartConfig): ChartDataResult {
  if (table.rows.length === 0) return { kind: "empty" };

  if (config.chartType === "histogram") {
    const idx = columnIndex(table.headers, config.xColumn);
    if (idx < 0) return { kind: "no-numeric-series" };
    const values = table.rows
      .map((r) => parseNumeric(r[idx] ?? ""))
      .filter((v): v is number => v !== null);
    if (values.length === 0) return { kind: "empty" };
    const { labels, counts } = buildHistogram(values);
    return {
      kind: "ok",
      xAxis: "category",
      categories: labels,
      series: [{ name: config.xColumn, points: counts }],
    };
  }

  const xIdx = columnIndex(table.headers, config.xColumn);
  if (xIdx < 0) return { kind: "empty" };
  const yIdxs = config.yColumns
    .map((name) => ({ name, idx: columnIndex(table.headers, name) }))
    .filter((c) => c.idx >= 0);
  if (yIdxs.length === 0) return { kind: "no-numeric-series" };

  const xValues = table.rows.map((r) => r[xIdx] ?? "");
  const xKind = detectXAxisKind(xValues);

  if (xKind === "category") {
    // カテゴリ軸: 行順を保ち、欠測は null（線を切る）
    const categories: string[] = [];
    const rowsUsed: number[] = [];
    table.rows.forEach((r, i) => {
      const label = (r[xIdx] ?? "").trim();
      if (label === "") return;
      categories.push(label);
      rowsUsed.push(i);
    });
    if (categories.length === 0) return { kind: "empty" };
    const series = yIdxs.map(({ name, idx }) => ({
      name,
      points: rowsUsed.map((i) => parseNumeric(table.rows[i][idx] ?? "")),
    }));
    return { kind: "ok", xAxis: "category", categories, series };
  }

  // time / value 軸: [x, y] ペア。x か y が読めない行はスキップ。x でソート
  const parseX = xKind === "time" ? parseDateTime : parseNumeric;
  const series = yIdxs.map(({ name, idx }) => {
    const points: Array<[number, number]> = [];
    for (const r of table.rows) {
      const x = parseX(r[xIdx] ?? "");
      const y = parseNumeric(r[idx] ?? "");
      if (x === null || y === null) continue;
      points.push([x, y]);
    }
    points.sort((a, b) => a[0] - b[0]);
    return { name, points };
  });
  if (series.every((s) => s.points.length === 0)) return { kind: "empty" };
  return { kind: "ok", xAxis: xKind, categories: [], series };
}

/** BlockNote の table ブロックから headers / rows のテキストを取り出す */
export function readTableData(tableBlock: any): TableData | null {
  if (!tableBlock || tableBlock.type !== "table") return null;
  const rows: any[] = tableBlock.content?.rows ?? [];
  if (rows.length === 0) return null;
  const cellText = (cell: any): string => {
    const content = Array.isArray(cell)
      ? cell
      : cell?.type === "tableCell"
        ? (cell.content ?? [])
        : null;
    if (!content) return "";
    return content
      .map((c: any) => (c?.type === "text" && typeof c.text === "string" ? c.text : ""))
      .join("")
      .trim();
  };
  const headers = (rows[0].cells ?? []).map(cellText);
  const dataRows = rows.slice(1).map((r: any) => (r.cells ?? []).map(cellText));
  return { headers, rows: dataRows };
}
