// chart-data.ts（チャートブロックのデータ変換純関数）のテスト

import { describe, it, expect } from "vitest";
import {
  parseNumeric,
  parseDateTime,
  detectXAxisKind,
  isNumericColumn,
  buildHistogram,
  buildChartData,
  pickInlineLabelAnchor,
  readTableData,
  applyStack,
  unstackValue,
  type ChartDataResult,
  type TableData,
} from "./chart-data";

describe("parseNumeric", () => {
  it("素の数値・小数・負数を読む", () => {
    expect(parseNumeric("6")).toBe(6);
    expect(parseNumeric("36.5")).toBe(36.5);
    expect(parseNumeric("-2")).toBe(-2);
    expect(parseNumeric(" 7 ")).toBe(7);
  });
  it("桁区切り・全角数字・単位付きを読む", () => {
    expect(parseNumeric("1,200")).toBe(1200);
    expect(parseNumeric("６")).toBe(6);
    expect(parseNumeric("36.5℃")).toBe(36.5);
    expect(parseNumeric("6/10")).toBe(6);
    expect(parseNumeric("1013hPa")).toBe(1013);
  });
  it("読めない値・空は null（0 に化けさせない）", () => {
    expect(parseNumeric("")).toBeNull();
    expect(parseNumeric("痛い")).toBeNull();
    expect(parseNumeric("N/A")).toBeNull();
  });
});

describe("parseDateTime", () => {
  it("format-datetime.ts の YYYY-MM-DD HH:MM をローカル時刻として読む", () => {
    const t = parseDateTime("2026-08-11 08:15");
    expect(t).toBe(new Date(2026, 7, 11, 8, 15).getTime());
  });
  it("日付のみも読む", () => {
    const t = parseDateTime("2026-08-11");
    expect(t).toBe(new Date(2026, 7, 11).getTime());
  });
  it("読めない値・空は null", () => {
    expect(parseDateTime("")).toBeNull();
    expect(parseDateTime("あした")).toBeNull();
  });
});

const diary: TableData = {
  headers: ["日時", "痛み", "気圧", "メモ"],
  rows: [
    ["2026-08-09 07:30", "6", "1008", "寝不足"],
    ["2026-08-10 21:00", "3", "1013", ""],
    ["2026-08-11 08:15", "7", "998", "台風"],
    ["2026-08-12 09:00", "", "1005", "欠測の日"],
  ],
};

describe("detectXAxisKind / isNumericColumn", () => {
  it("日時列は time、数値列は value、文字列は category", () => {
    expect(detectXAxisKind(diary.rows.map((r) => r[0]))).toBe("time");
    expect(detectXAxisKind(["1", "2", "3"])).toBe("value");
    expect(detectXAxisKind(["朝", "昼", "夜"])).toBe("category");
  });
  it("数値列判定（空セルは無視、過半で判定）", () => {
    expect(isNumericColumn(diary, "痛み")).toBe(true);
    expect(isNumericColumn(diary, "気圧")).toBe(true);
    expect(isNumericColumn(diary, "メモ")).toBe(false);
    expect(isNumericColumn(diary, "存在しない列")).toBe(false);
  });
});

describe("buildHistogram", () => {
  it("空・同値のエッジケース", () => {
    expect(buildHistogram([])).toEqual({ labels: [], counts: [] });
    expect(buildHistogram([5, 5, 5])).toEqual({ labels: ["5"], counts: [3] });
  });
  it("counts の合計 = 値の個数", () => {
    const values = [1, 2, 2, 3, 5, 6, 6, 7, 8, 10];
    const { labels, counts } = buildHistogram(values);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(values.length);
    expect(labels.length).toBe(counts.length);
  });
});

describe("buildChartData（系列ごとにテーブルを持つ）", () => {
  it("time 軸: 欠測行をスキップし x でソートした [x, y] ペア", () => {
    const result = buildChartData({
      chartType: "line",
      series: [{ table: diary, xColumn: "日時", yColumn: "痛み" }],
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.xAxis).toBe("time");
    const points = result.series[0].points as Array<[number, number]>;
    expect(points.length).toBe(3);
    expect(points.map((p) => p[1])).toEqual([6, 3, 7]);
    expect(points[0][0]).toBeLessThan(points[1][0]);
  });

  it("複数テーブルを 1 チャートに重ねられる（eureco の複数ソース統合）", () => {
    const other: TableData = {
      headers: ["日時", "睡眠(h)"],
      rows: [
        ["2026-08-09 07:30", "5"],
        ["2026-08-10 21:00", "8"],
      ],
    };
    const result = buildChartData({
      chartType: "line",
      series: [
        { table: diary, xColumn: "日時", yColumn: "痛み" },
        { table: other, xColumn: "日時", yColumn: "睡眠(h)" },
      ],
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.series.length).toBe(2);
    expect((result.series[0].points as any[]).length).toBe(3);
    expect((result.series[1].points as any[]).length).toBe(2);
  });

  it("category 軸: 全系列のラベルを出現順にマージし、欠測は null で整列", () => {
    const a: TableData = {
      headers: ["条件", "収率"],
      rows: [
        ["A", "87"],
        ["B", "90"],
      ],
    };
    const b: TableData = {
      headers: ["条件", "純度"],
      rows: [
        ["B", "95"],
        ["C", "99"],
      ],
    };
    const result = buildChartData({
      chartType: "bar",
      series: [
        { table: a, xColumn: "条件", yColumn: "収率" },
        { table: b, xColumn: "条件", yColumn: "純度" },
      ],
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.xAxis).toBe("category");
    expect(result.categories).toEqual(["A", "B", "C"]);
    expect(result.series[0].points).toEqual([87, 90, null]);
    expect(result.series[1].points).toEqual([null, 95, 99]);
  });

  it("histogram: 全系列で共通のビンを使い分布を比較できる", () => {
    const result = buildChartData({
      chartType: "histogram",
      series: [
        { table: diary, xColumn: "", yColumn: "痛み" },
        { table: diary, xColumn: "", yColumn: "気圧" },
      ],
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const total0 = (result.series[0].points as number[]).reduce((a, b) => a + b, 0);
    const total1 = (result.series[1].points as number[]).reduce((a, b) => a + b, 0);
    expect(total0).toBe(3); // 痛みが読めた行
    expect(total1).toBe(4); // 気圧が読めた行
    // 共通ビンなのでカテゴリ数は一致する
    expect((result.series[0].points as number[]).length).toBe(result.categories.length);
    expect((result.series[1].points as number[]).length).toBe(result.categories.length);
  });

  it("参照切れの系列は空のまま残る（index 対応を崩さない）", () => {
    const result = buildChartData({
      chartType: "line",
      series: [
        { table: null, xColumn: "日時", yColumn: "痛み" },
        { table: diary, xColumn: "日時", yColumn: "痛み" },
      ],
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.series.length).toBe(2);
    expect((result.series[0].points as any[]).length).toBe(0);
    expect((result.series[1].points as any[]).length).toBe(3);
  });

  it("系列なし・全系列空はエラーでなく状態で返す", () => {
    expect(buildChartData({ chartType: "line", series: [] }).kind).toBe("no-series");
    expect(
      buildChartData({
        chartType: "line",
        series: [{ table: null, xColumn: "a", yColumn: "b" }],
      }).kind
    ).toBe("empty");
  });

  it("X 軸種類の明示指定が推定より優先される", () => {
    const result = buildChartData({
      chartType: "line",
      series: [{ table: diary, xColumn: "日時", yColumn: "痛み" }],
      xAxisKind: "category",
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.xAxis).toBe("category");
    expect(result.categories.length).toBe(4);
  });

  it("棒グラフでも X 軸種類を明示すれば数値軸になる（範囲指定のため）", () => {
    const result = buildChartData({
      chartType: "bar",
      series: [{ table: diary, xColumn: "気圧", yColumn: "痛み" }],
      xAxisKind: "value",
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.xAxis).toBe("value");
    // [x, y] のペアで返る（カテゴリ整列ではない）
    expect(result.series[0].points[0]).toHaveLength(2);
  });

  it("棒グラフの既定は推定に頼らずカテゴリ軸（数値ラベルでも棒はカテゴリカル）", () => {
    const result = buildChartData({
      chartType: "bar",
      series: [{ table: diary, xColumn: "気圧", yColumn: "痛み" }],
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.xAxis).toBe("category");
  });
});

describe("pickInlineLabelAnchor", () => {
  const points: Array<[number, number]> = [
    [20, 1],
    [40, 5],
    [55, 2],
    [64, 3],
    [72, 1],
  ];

  it("範囲を絞ると、その中の最後の点を返す（段名が枠外へ出ない）", () => {
    expect(pickInlineLabelAnchor(points, 20, 60)).toEqual([55, 2]);
  });

  it("範囲の指定が無ければ最後の点", () => {
    expect(pickInlineLabelAnchor(points, null, null)).toEqual([72, 1]);
  });

  it("範囲内に 1 点も無ければ null（名前を出さない）", () => {
    expect(pickInlineLabelAnchor(points, 80, 90)).toBeNull();
    expect(pickInlineLabelAnchor([], null, null)).toBeNull();
  });
});

describe("readTableData", () => {
  it("旧 inline 配列セルと tableCell 型の両方を読む", () => {
    const legacy = {
      type: "table",
      content: {
        type: "tableContent",
        rows: [
          { cells: [[{ type: "text", text: "日時", styles: {} }]] },
          { cells: [[{ type: "text", text: "2026-08-09 07:30", styles: {} }]] },
        ],
      },
    };
    expect(readTableData(legacy)).toEqual({
      headers: ["日時"],
      rows: [["2026-08-09 07:30"]],
    });

    const modern = {
      type: "table",
      content: {
        type: "tableContent",
        rows: [
          { cells: [{ type: "tableCell", content: [{ type: "text", text: "値", styles: {} }], props: {} }] },
          { cells: [{ type: "tableCell", content: [{ type: "text", text: "6", styles: {} }], props: {} }] },
        ],
      },
    };
    expect(readTableData(modern)).toEqual({ headers: ["値"], rows: [["6"]] });
  });

  it("table 以外・空は null", () => {
    expect(readTableData(null)).toBeNull();
    expect(readTableData({ type: "paragraph" })).toBeNull();
    expect(readTableData({ type: "table", content: { rows: [] } })).toBeNull();
  });
});

describe("applyStack", () => {
  // 強度の桁が 10 倍違う 2 パターン（XRD で測定と文献を並べる典型）
  const twoSpectra = (): Extract<ChartDataResult, { kind: "ok" }> => ({
    kind: "ok",
    xAxis: "value",
    categories: [],
    series: [
      { points: [[10, 500], [20, 1000], [30, 250]] },
      { points: [[10, 50], [20, 25], [30, 100]] },
    ],
  });

  it("各段を最大 1 に規格化してから段間隔だけ持ち上げる", () => {
    const out = applyStack(twoSpectra(), {
      normalize: "max",
      gap: 1.2,
      order: "first-bottom",
      perSeries: [undefined, undefined],
    });
    // 段 1 は offset 0 で、最大値 1000 が 1.0 になる
    expect(out.series[0].points).toEqual([[10, 0.5], [20, 1], [30, 0.25]]);
    // 段 2 は offset 1.2 に載る。桁が違っても同じ高さに揃う
    expect(out.series[1].points).toEqual([[10, 1.7], [20, 1.45], [30, 2.2]]);
  });

  it("元の値に戻せるよう offset と scale を残す", () => {
    const out = applyStack(twoSpectra(), {
      normalize: "max",
      gap: 1,
      order: "first-bottom",
      perSeries: [undefined, undefined],
    });
    const s = out.series[1];
    const drawn = (s.points as Array<[number, number]>)[0][1];
    expect((drawn - s.offset!) / s.scale!).toBeCloseTo(50);
  });

  it("first-top では系列 1 が最上段に来る", () => {
    const out = applyStack(twoSpectra(), {
      normalize: "max",
      gap: 1,
      order: "first-top",
      perSeries: [undefined, undefined],
    });
    expect(out.series[0].offset).toBe(1);
    expect(out.series[1].offset).toBe(0);
  });

  it("系列ごとの倍率と段位置の微調整が効く", () => {
    const out = applyStack(twoSpectra(), {
      normalize: "max",
      gap: 1,
      order: "first-bottom",
      perSeries: [{ scale: 2 }, { offsetAdjust: 0.5 }],
    });
    // ×2 したので最大値は 2.0
    expect(out.series[0].points).toEqual([[10, 1], [20, 2], [30, 0.5]]);
    expect(out.series[1].offset).toBe(1.5);
  });

  it("normalize: none は生値のまま積む", () => {
    const out = applyStack(twoSpectra(), {
      normalize: "none",
      gap: 1,
      order: "first-bottom",
      perSeries: [undefined, undefined],
    });
    expect(out.series[0].points).toEqual([[10, 500], [20, 1000], [30, 250]]);
    expect(out.series[1].points).toEqual([[10, 51], [20, 26], [30, 101]]);
  });

  it("最大値が 0 以下・空の系列でも割り算で壊れない", () => {
    const out = applyStack(
      {
        kind: "ok",
        xAxis: "value",
        categories: [],
        series: [{ points: [] }, { points: [[1, 0], [2, -5]] }],
      },
      { normalize: "max", gap: 1, order: "first-bottom", perSeries: [undefined, undefined] }
    );
    expect(out.series[0].points).toEqual([]);
    expect(out.series[0].scale).toBe(1);
    // 規格化できないので生値のまま段だけ上がる
    expect(out.series[1].points).toEqual([[1, 1], [2, -4]]);
  });

  it("カテゴリ軸には何もしない（段のオフセットが目盛りとかみ合わないため）", () => {
    const input: Extract<ChartDataResult, { kind: "ok" }> = {
      kind: "ok",
      xAxis: "category",
      categories: ["A", "B"],
      series: [{ points: [1, 2] }],
    };
    expect(applyStack(input, {
      normalize: "max",
      gap: 1,
      order: "first-bottom",
      perSeries: [undefined],
    })).toBe(input);
  });
});

describe("unstackValue", () => {
  it("規格化 + 段オフセットを打ち消して元の測定値に戻す", () => {
    const stacked = applyStack(
      {
        kind: "ok",
        xAxis: "value",
        categories: [],
        series: [{ points: [[10, 500], [20, 1000]] }, { points: [[10, 30], [20, 90]] }],
      },
      { normalize: "max", gap: 1.2, order: "first-bottom", perSeries: [undefined, { scale: 2 }] }
    );
    const back = (i: number) =>
      (stacked.series[i].points as Array<[number, number]>).map(([, y]) =>
        unstackValue(y, stacked.series[i])
      );
    expect(back(0)).toEqual([500, 1000]);
    expect(back(1)).toEqual([30, 90]);
  });

  it("割り戻しの浮動小数点誤差を丸める", () => {
    expect(unstackValue(1.3, { points: [], offset: 1, scale: 1 / 3 })).toBe(0.9);
  });

  it("未変換の系列・欠けた系列はそのまま返す", () => {
    expect(unstackValue(42, { points: [] })).toBe(42);
    expect(unstackValue(42, undefined)).toBe(42);
  });
});
