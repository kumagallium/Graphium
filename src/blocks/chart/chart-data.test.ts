// chart-data.ts（チャートブロックのデータ変換純関数）のテスト

import { describe, it, expect } from "vitest";
import {
  parseNumeric,
  parseDateTime,
  detectXAxisKind,
  isNumericColumn,
  buildHistogram,
  buildChartData,
  readTableData,
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
