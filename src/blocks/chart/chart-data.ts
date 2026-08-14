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

export type XAxisKind = "time" | "value" | "category";

/**
 * 1 系列分のデータ仕様（テーブルは解決済みで渡す）。
 * 系列ごとにテーブルが違ってよい = 複数テーブルを 1 チャートに重ねられる。
 */
export type SeriesSpec = {
  /** 解決済みテーブル。参照切れは null（その系列は空になる） */
  table: TableData | null;
  /** X に使う列名（histogram では未使用） */
  xColumn: string;
  /** Y（値）に使う列名 */
  yColumn: string;
};

export type MultiChartConfig = {
  chartType: ChartType;
  series: SeriesSpec[];
  /** X 軸の種類を明示する（未指定 = 全系列の値から推定）。棒・分布はカテゴリ固定 */
  xAxisKind?: XAxisKind;
};

export type ChartSeriesData = {
  /** time/value 軸: [x, y] のペア。category 軸: categories に整列した y（欠測 null） */
  points: Array<[number, number]> | Array<number | null>;
  /**
   * スタック表示で加えた段オフセット。ツールチップで元の値に戻すために持つ
   *（描画上の y は生データではなくなるため）。未変換なら undefined
   */
  offset?: number;
  /** スタック表示で掛けた倍率（規格化 × 系列ごとの倍率）。未変換なら undefined */
  scale?: number;
};

export type ChartDataResult =
  | {
      kind: "ok";
      xAxis: XAxisKind;
      /** category 軸のときの X ラベル列 */
      categories: string[];
      /** 入力 series と同順・同数（読めない系列は points 空） */
      series: ChartSeriesData[];
    }
  | { kind: "empty" }
  | { kind: "no-series" };

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

/** ヒストグラムのビン分割（Sturges の公式ベース、キリの良い幅に丸める） */
function computeBins(values: number[], seriesCount: number): {
  start: number;
  width: number;
  bins: number;
  labels: string[];
} | null {
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return { start: min, width: 1, bins: 1, labels: [String(min)] };
  }
  const binCount = Math.max(1, Math.ceil(Math.log2(values.length / Math.max(1, seriesCount)) + 1));
  const rawWidth = (max - min) / binCount;
  // 1/2/5 × 10^n に丸めて境界を読みやすくする
  const pow = Math.pow(10, Math.floor(Math.log10(rawWidth)));
  const width = [1, 2, 5, 10].map((f) => f * pow).find((w) => w >= rawWidth) ?? rawWidth;
  const start = Math.floor(min / width) * width;
  const bins = Math.max(1, Math.ceil((max - start) / width + 1e-9));
  const fmt = (n: number) => String(Math.round(n * 1e6) / 1e6);
  const labels = Array.from({ length: bins }, (_, i) => `${fmt(start + i * width)}–${fmt(start + (i + 1) * width)}`);
  return { start, width, bins, labels };
}

/** ヒストグラム（単一系列）。テストと後方互換のため公開を維持 */
export function buildHistogram(values: number[]): { labels: string[]; counts: number[] } {
  const binSpec = computeBins(values, 1);
  if (!binSpec) return { labels: [], counts: [] };
  const counts = new Array(binSpec.bins).fill(0);
  for (const v of values) {
    if (binSpec.bins === 1) {
      counts[0]++;
      continue;
    }
    const i = Math.min(binSpec.bins - 1, Math.floor((v - binSpec.start) / binSpec.width));
    counts[i]++;
  }
  return { labels: binSpec.labels, counts };
}

/** 系列のテーブルから列の値を取り出す（テーブル無し・列無しは空配列） */
function seriesColumnValues(spec: SeriesSpec, column: string): string[] {
  if (!spec.table) return [];
  const idx = columnIndex(spec.table.headers, column);
  if (idx < 0) return [];
  return spec.table.rows.map((r) => r[idx] ?? "");
}

/**
 * 系列の束 → 描画可能なデータ。系列ごとにテーブルが違ってよい。
 * ここが「集計層」の境界: 将来 CSV や外部エンジンに差し替えるときは
 * この関数と同じ出力を返す実装を用意すればよい。
 */
export function buildChartData(config: MultiChartConfig): ChartDataResult {
  if (config.series.length === 0) return { kind: "no-series" };

  if (config.chartType === "histogram") {
    // 全系列で共通のビンを使う（分布の比較ができるように）
    const perSeries = config.series.map((s) =>
      seriesColumnValues(s, s.yColumn)
        .map((v) => parseNumeric(v))
        .filter((v): v is number => v !== null)
    );
    const all = perSeries.flat();
    const binSpec = computeBins(all, config.series.length);
    if (!binSpec) return { kind: "empty" };
    const series = perSeries.map((values) => {
      const counts = new Array(binSpec.bins).fill(0);
      for (const v of values) {
        const i =
          binSpec.bins === 1
            ? 0
            : Math.min(binSpec.bins - 1, Math.floor((v - binSpec.start) / binSpec.width));
        counts[i]++;
      }
      return { points: counts as number[] };
    });
    return { kind: "ok", xAxis: "category", categories: binSpec.labels, series };
  }

  // 棒グラフはカテゴリ軸に固定する（学術図の作法として棒はカテゴリカル。
  // time 軸に棒を置くと ECharts はバー幅を決められず 1px に潰れる）。
  // それ以外は明示指定 > 全系列の X 値からの推定
  const xKind =
    config.chartType === "bar"
      ? "category"
      : (config.xAxisKind ??
        detectXAxisKind(config.series.flatMap((s) => seriesColumnValues(s, s.xColumn))));

  if (xKind === "category") {
    // カテゴリ軸: 全系列のラベルを出現順にマージし、各系列をそこへ整列する
    // （同名ラベルは 1 つに束ねる。複数テーブルを重ねるための键化）
    const categories: string[] = [];
    const catIndex = new Map<string, number>();
    const perSeries = config.series.map((s) => {
      if (!s.table) return new Map<string, number>();
      const xIdx = columnIndex(s.table.headers, s.xColumn);
      const yIdx = columnIndex(s.table.headers, s.yColumn);
      if (xIdx < 0 || yIdx < 0) return new Map<string, number>();
      const valueByLabel = new Map<string, number>();
      for (const r of s.table.rows) {
        const label = (r[xIdx] ?? "").trim();
        if (label === "") continue;
        if (!catIndex.has(label)) {
          catIndex.set(label, categories.length);
          categories.push(label);
        }
        const y = parseNumeric(r[yIdx] ?? "");
        if (y !== null && !valueByLabel.has(label)) valueByLabel.set(label, y);
      }
      return valueByLabel;
    });
    if (categories.length === 0) return { kind: "empty" };
    const series = perSeries.map((valueByLabel) => ({
      points: categories.map((label) => valueByLabel.get(label) ?? null),
    }));
    return { kind: "ok", xAxis: "category", categories, series };
  }

  // time / value 軸: [x, y] ペア。x か y が読めない行はスキップ。x でソート
  const parseX = xKind === "time" ? parseDateTime : parseNumeric;
  const series = config.series.map((s) => {
    const points: Array<[number, number]> = [];
    if (s.table) {
      const xIdx = columnIndex(s.table.headers, s.xColumn);
      const yIdx = columnIndex(s.table.headers, s.yColumn);
      if (xIdx >= 0 && yIdx >= 0) {
        for (const r of s.table.rows) {
          const x = parseX(r[xIdx] ?? "");
          const y = parseNumeric(r[yIdx] ?? "");
          if (x === null || y === null) continue;
          points.push([x, y]);
        }
        points.sort((a, b) => a[0] - b[0]);
      }
    }
    return { points };
  });
  if (series.every((s) => s.points.length === 0)) return { kind: "empty" };
  return { kind: "ok", xAxis: xKind, categories: [], series };
}

/** スタック変換の指定。perSeries は系列と同順（欠けは既定値として扱う） */
export type StackSpec = {
  normalize: "max" | "none";
  gap: number;
  order: "first-bottom" | "first-top";
  perSeries: Array<{ scale?: number; offsetAdjust?: number } | undefined>;
};

/**
 * 系列を縦にずらして積む（XRD などのスペクトル比較図）。
 *
 * 規格化してから段オフセットを足すだけで、ECharts 側に特別な機能は要らない。
 * 規格化が既定なのは、生値のままだと系列ごとに強度の桁が違って段間隔を
 * 決められないため。段の縦位置に意味は無くなる（a.u.）ので、描画側は
 * 縦軸の目盛りを隠す前提で使う。
 *
 * 元の値はここで失われるため、戻せるように offset / scale を各系列に残す。
 * カテゴリ軸は段のオフセットが目盛りとかみ合わないので何もしない。
 */
export function applyStack(
  result: Extract<ChartDataResult, { kind: "ok" }>,
  spec: StackSpec
): Extract<ChartDataResult, { kind: "ok" }> {
  if (result.xAxis === "category") return result;
  const count = result.series.length;
  const series = result.series.map((s, i) => {
    const points = s.points as Array<[number, number]>;
    const per = spec.perSeries[i];
    const userScale = per?.scale !== undefined && per.scale > 0 ? per.scale : 1;
    // 規格化: その段の最大値を 1 に。最大値が 0 以下なら割れないので素通しする。
    // XRD は 1 パターン数千点になるため Math.max(...spread) は使わない（引数上限で落ちる）
    let yMax = 0;
    for (const [, y] of points) if (y > yMax) yMax = y;
    const normScale = spec.normalize === "max" && yMax > 0 ? 1 / yMax : 1;
    const scale = normScale * userScale;
    // 段の位置。first-bottom は系列 1 が最下段（測定データを下に置く慣習）
    const step = spec.order === "first-bottom" ? i : count - 1 - i;
    const offset = step * spec.gap + (per?.offsetAdjust ?? 0);
    return {
      points: points.map(([x, y]) => [x, y * scale + offset] as [number, number]),
      offset,
      scale,
    };
  });
  return { ...result, series };
}

/**
 * スタックで変換した描画値を元の測定値に戻す（ツールチップ用）。
 * 未変換の系列はそのまま返す。
 */
export function unstackValue(drawn: number, series: ChartSeriesData | undefined): number {
  if (!series?.scale) return drawn;
  const raw = (drawn - (series.offset ?? 0)) / series.scale;
  // 規格化の割り戻しで 0.30000000000000004 のような桁が出るので丸める
  return Math.round(raw * 1e6) / 1e6;
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
