import { describe, it, expect } from "vitest";
import {
  parseDataTableSource,
  serializeDataTableSource,
  estimateRowCount,
  buildColumnModels,
  tableWidth,
  visibleRowRange,
  orderRows,
  viewportHeightFor,
  MIN_COLUMN_WIDTH,
  MAX_COLUMN_WIDTH,
  INDEX_COLUMN_WIDTH,
  ROW_HEIGHT,
  HEADER_HEIGHT,
  VISIBLE_ROWS,
} from "./model";
import type { TableSource } from "../../lib/document-types";

const baseSource: TableSource = {
  kind: "delimited-file",
  fileName: "oven-log.csv",
  fileId: "asset-1",
  importedAt: "2026-09-05T00:00:00.000Z",
  options: {
    headerRow: 1,
    endRow: 201,
    delimiter: "comma",
    collapseConsecutive: false,
  },
};

describe("parseDataTableSource", () => {
  it("正常な JSON を TableSource として読む", () => {
    const raw = serializeDataTableSource(baseSource);
    expect(parseDataTableSource(raw)).toEqual(baseSource);
  });

  it("空文字は null", () => {
    expect(parseDataTableSource("")).toBeNull();
    expect(parseDataTableSource("   ")).toBeNull();
  });

  it("文字列以外（undefined・数値など）は null", () => {
    expect(parseDataTableSource(undefined)).toBeNull();
    expect(parseDataTableSource(123)).toBeNull();
  });

  it("壊れた JSON は null", () => {
    expect(parseDataTableSource("{not json")).toBeNull();
  });

  it("JSON だが object でない（配列・文字列リテラル）は null", () => {
    expect(parseDataTableSource("123")).toBeNull();
    expect(parseDataTableSource('"str"')).toBeNull();
    expect(parseDataTableSource("null")).toBeNull();
  });

  it("fileName が無い・文字列でないと null", () => {
    const { fileName, ...rest } = baseSource as any;
    expect(parseDataTableSource(JSON.stringify(rest))).toBeNull();
    expect(parseDataTableSource(JSON.stringify({ ...baseSource, fileName: 1 }))).toBeNull();
  });

  it("options が無い・object でないと null", () => {
    const { options, ...rest } = baseSource as any;
    expect(parseDataTableSource(JSON.stringify(rest))).toBeNull();
    expect(parseDataTableSource(JSON.stringify({ ...baseSource, options: "x" }))).toBeNull();
  });

  it("headerRow / endRow が数値でないと null", () => {
    expect(
      parseDataTableSource(
        JSON.stringify({ ...baseSource, options: { ...baseSource.options, headerRow: "1" } }),
      ),
    ).toBeNull();
    expect(
      parseDataTableSource(
        JSON.stringify({ ...baseSource, options: { ...baseSource.options, endRow: "201" } }),
      ),
    ).toBeNull();
  });
});

describe("serializeDataTableSource / parseDataTableSource の往復", () => {
  it("serialize してから parse すると同じ値に戻る", () => {
    const roundtrip = parseDataTableSource(serializeDataTableSource(baseSource));
    expect(roundtrip).toEqual(baseSource);
  });

  it("meta 付きでも往復できる", () => {
    const withMeta: TableSource = {
      ...baseSource,
      meta: [{ key: "Device Model", value: "OVEN-1" }],
    };
    expect(parseDataTableSource(serializeDataTableSource(withMeta))).toEqual(withMeta);
  });
});

describe("estimateRowCount", () => {
  it("endRow - headerRow を返す", () => {
    expect(estimateRowCount(baseSource)).toBe(200);
  });

  it("endRow が headerRow 以下なら 0 に丸める", () => {
    expect(
      estimateRowCount({ ...baseSource, options: { ...baseSource.options, headerRow: 5, endRow: 5 } }),
    ).toBe(0);
    expect(
      estimateRowCount({ ...baseSource, options: { ...baseSource.options, headerRow: 5, endRow: 1 } }),
    ).toBe(0);
  });

  it("headerRow / endRow が有限でなければ null", () => {
    expect(
      estimateRowCount({
        ...baseSource,
        options: { ...baseSource.options, headerRow: NaN, endRow: 10 },
      }),
    ).toBeNull();
    expect(
      estimateRowCount({
        ...baseSource,
        options: { ...baseSource.options, headerRow: 1, endRow: Infinity },
      }),
    ).toBeNull();
  });
});

describe("buildColumnModels", () => {
  it("短い見出し・短い値の列は最小幅（MIN_COLUMN_WIDTH）になる", () => {
    const [col] = buildColumnModels(["x"], [["1"], ["2"]]);
    expect(col.width).toBe(MIN_COLUMN_WIDTH);
  });

  it("非常に長い値の列は最大幅（MAX_COLUMN_WIDTH）でクランプされる", () => {
    const longValue = "a".repeat(200);
    const [col] = buildColumnModels(["x"], [[longValue]]);
    expect(col.width).toBe(MAX_COLUMN_WIDTH);
  });

  it("見出し自体が長い場合も見出し長を考慮する", () => {
    const longHeader = "h".repeat(200);
    const [col] = buildColumnModels([longHeader], [["1"]]);
    expect(col.width).toBe(MAX_COLUMN_WIDTH);
  });

  it("数値だけの列は numeric: true、文字列混じりは numeric: false", () => {
    const [numCol, strCol] = buildColumnModels(
      ["temp_c", "note"],
      [
        ["25.1", "clear"],
        ["25.4", "cloudy"],
        ["26.0", "clear"],
      ],
    );
    expect(numCol.numeric).toBe(true);
    expect(strCol.numeric).toBe(false);
  });

  it("列数ぶんの ColumnModel を返す", () => {
    const cols = buildColumnModels(["a", "b", "c"], [["1", "2", "3"]]);
    expect(cols).toHaveLength(3);
  });
});

describe("tableWidth", () => {
  it("行番号列の幅 + 各列幅の合計を返す", () => {
    const columns = [
      { width: 100, numeric: false },
      { width: 150, numeric: true },
    ];
    expect(tableWidth(columns)).toBe(INDEX_COLUMN_WIDTH + 100 + 150);
  });

  it("列が無ければ行番号列の幅だけ", () => {
    expect(tableWidth([])).toBe(INDEX_COLUMN_WIDTH);
  });
});

describe("visibleRowRange", () => {
  it("先頭（scrollTop 0）は 0 から始まり、オーバースキャン分だけ余分に見える", () => {
    const viewportHeight = 200; // 200/28 ≈ 7.14 → visible = 8
    const range = visibleRowRange(0, viewportHeight, 1000);
    expect(range.start).toBe(0); // 先頭なのでマイナス方向へはクランプ
    expect(range.end).toBe(Math.min(1000, 0 + 8 + 1 + 8));
  });

  it("中間のスクロール位置では前後に OVERSCAN_ROWS 行の余裕を持つ", () => {
    const scrollTop = 100 * ROW_HEIGHT; // ちょうど 100 行目から見える
    const range = visibleRowRange(scrollTop, 200, 1000);
    expect(range.start).toBe(100 - 8);
    expect(range.end).toBeLessThanOrEqual(1000);
  });

  it("末尾付近では end が rowCount を超えない", () => {
    const scrollTop = 990 * ROW_HEIGHT;
    const range = visibleRowRange(scrollTop, 200, 1000);
    expect(range.end).toBe(1000);
    expect(range.end).toBeLessThanOrEqual(1000);
  });

  it("rowCount が 0 なら常に空範囲", () => {
    expect(visibleRowRange(0, 200, 0)).toEqual({ start: 0, end: 0 });
    expect(visibleRowRange(500, 200, 0)).toEqual({ start: 0, end: 0 });
  });

  it("負のスクロール位置は 0 として扱う（クランプ）", () => {
    const range = visibleRowRange(-100, 200, 1000);
    expect(range.start).toBe(0);
  });
});

describe("orderRows", () => {
  const rows = [
    ["10"],
    ["2"],
    ["30"],
  ];

  it("sort が null なら元の順のまま（恒等写像）", () => {
    expect(orderRows(rows, null)).toEqual([0, 1, 2]);
  });

  it("数値列の昇順で並べ替える", () => {
    expect(orderRows(rows, { col: 0, dir: "asc" })).toEqual([1, 0, 2]); // 2, 10, 30
  });

  it("数値列の降順で並べ替える", () => {
    expect(orderRows(rows, { col: 0, dir: "desc" })).toEqual([2, 0, 1]); // 30, 10, 2
  });
});

describe("viewportHeightFor", () => {
  it("1 行なら HEADER_HEIGHT + 1 行分", () => {
    expect(viewportHeightFor(1)).toBe(HEADER_HEIGHT + ROW_HEIGHT);
  });

  it("VISIBLE_ROWS（12 行）ちょうどなら HEADER_HEIGHT + 12 行分", () => {
    expect(viewportHeightFor(VISIBLE_ROWS)).toBe(HEADER_HEIGHT + VISIBLE_ROWS * ROW_HEIGHT);
  });

  it("2,000 行でも VISIBLE_ROWS でクランプされ、12 行ちょうどと同じ高さ", () => {
    expect(viewportHeightFor(2000)).toBe(HEADER_HEIGHT + VISIBLE_ROWS * ROW_HEIGHT);
  });

  it("0 行でも最低 1 行分の高さを確保する", () => {
    expect(viewportHeightFor(0)).toBe(HEADER_HEIGHT + ROW_HEIGHT);
  });
});
