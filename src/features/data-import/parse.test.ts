import { describe, it, expect } from "vitest";
import {
  parseDelimited,
  parseDelimitedLines,
  parseDelimitedLinesAsync,
  parseDelimitedSample,
  countDataRows,
  splitLine,
  splitLines,
  resolveDelimiter,
} from "./parse";
import type { DelimitedImportOptions } from "./types";

const base: DelimitedImportOptions = {
  headerRow: 1,
  endRow: 100,
  delimiter: "comma",
  collapseConsecutive: false,
};

describe("splitLines", () => {
  it("CRLF / CR / LF を同じように割る", () => {
    expect(splitLines("a\r\nb\rc\nd")).toEqual(["a", "b", "c", "d"]);
  });

  it("先頭 BOM を落とす", () => {
    expect(splitLines("﻿日付,値")).toEqual(["日付,値"]);
  });
});

describe("splitLine", () => {
  it("クォート内の区切りはセルを割らない", () => {
    expect(splitLine('a,"b,c",d', ",", false)).toEqual(["a", "b,c", "d"]);
  });

  it("クォートのエスケープ（\"\"）を 1 文字に戻す", () => {
    expect(splitLine('a,"b""c"', ",", false)).toEqual(["a", 'b"c']);
  });

  it("collapse なしでは空セルを残す", () => {
    expect(splitLine("a,,b", ",", false)).toEqual(["a", "", "b"]);
  });

  it("collapse ありでは連続区切りをまとめ、両端の余白も消す", () => {
    expect(splitLine("  1.0   2.0    3.0  ", " ", true)).toEqual(["1.0", "2.0", "3.0"]);
  });
});

describe("resolveDelimiter", () => {
  it("custom は 1 文字目だけを使う", () => {
    expect(resolveDelimiter({ delimiter: "custom", customDelimiter: "|x" })).toBe("|");
  });

  it("custom が空なら null（区切れない）", () => {
    expect(resolveDelimiter({ delimiter: "custom", customDelimiter: "" })).toBeNull();
  });
});

describe("parseDelimited", () => {
  const instrumentFile = [
    "# [INSTRUMENT SETTINGS & METADATA]",
    "# Device Model: ENV-MONITOR-X9",
    "# Location: Site B",
    "# --------------------------",
    "# [DATA START]",
    "日付,最高気温,平均湿度,地点",
    "8月1日,35.2,75,地点B",
    "8月2日,36.5,80,地点B",
    "# [DATA END]",
    "# checksum: 0x2f",
  ].join("\n");

  it("見出し行より前を headerLines、終了行より後を footerLines に分ける", () => {
    const result = parseDelimited(instrumentFile, { ...base, headerRow: 6, endRow: 8 });
    expect(result.headers).toEqual(["日付", "最高気温", "平均湿度", "地点"]);
    expect(result.rows).toEqual([
      ["8月1日", "35.2", "75", "地点B"],
      ["8月2日", "36.5", "80", "地点B"],
    ]);
    expect(result.headerLines).toHaveLength(5);
    expect(result.footerLines).toEqual(["# [DATA END]", "# checksum: 0x2f"]);
  });

  it("見出しより列が少ない行は空セルで埋める", () => {
    const result = parseDelimited("a,b,c\n1,2", { ...base, endRow: 2 });
    expect(result.rows).toEqual([["1", "2", ""]]);
  });

  it("見出しより列が多いときは切らず、見出し側を空セルで伸ばす", () => {
    // クォート無しの CSV（(hkl) 列に (0,0,2) が入る等）でデータが消えないこと。
    // 切り落とすと値が黙って失われ、取り込み元を見ない限り気づけない
    const result = parseDelimited("a,b\n1,2,3\n4,5,6", { ...base, endRow: 3 });
    expect(result.headers).toEqual(["a", "b", ""]);
    expect(result.rows).toEqual([["1", "2", "3"], ["4", "5", "6"]]);
  });

  it("列数がばらつく場合は最頻値に合わせ、外れた行だけ揃える", () => {
    const result = parseDelimited("a,b\n1,2\n3,4\n5,6,7", { ...base, endRow: 4 });
    expect(result.headers).toEqual(["a", "b"]);
    expect(result.rows).toEqual([["1", "2"], ["3", "4"], ["5", "6"]]);
  });

  it("範囲内の空行は行にしない", () => {
    const result = parseDelimited("a,b\n1,2\n\n3,4", { ...base, endRow: 4 });
    expect(result.rows).toEqual([["1", "2"], ["3", "4"]]);
  });

  it("endRow が本文より長くても落ちない", () => {
    const result = parseDelimited("a,b\n1,2", { ...base, endRow: 9999 });
    expect(result.rows).toEqual([["1", "2"]]);
  });

  it("headerRow が endRow より後なら空の結果を返す", () => {
    const result = parseDelimited("a,b\n1,2", { ...base, headerRow: 2, endRow: 1 });
    expect(result.headers).toEqual([]);
    expect(result.rows).toEqual([]);
  });

  it("空白区切り + collapse で固定幅出力を読める", () => {
    const text = "TIME    TEMP    PRESS\n0.0     25.1    101.3\n1.0     25.4    101.2";
    const result = parseDelimited(text, {
      ...base,
      endRow: 3,
      delimiter: "space",
      collapseConsecutive: true,
    });
    expect(result.headers).toEqual(["TIME", "TEMP", "PRESS"]);
    expect(result.rows).toEqual([
      ["0.0", "25.1", "101.3"],
      ["1.0", "25.4", "101.2"],
    ]);
  });

  it("タブ区切りを読める", () => {
    const result = parseDelimited("a\tb\n1\t2", {
      ...base,
      endRow: 2,
      delimiter: "tab",
    });
    expect(result.headers).toEqual(["a", "b"]);
    expect(result.rows).toEqual([["1", "2"]]);
  });
});

// ── 大きなファイル向けの派生関数 ──
// 既存の parseDelimited と結果が一致することが不変条件。

const EQUIV_CASES: { name: string; text: string; options: DelimitedImportOptions }[] = [
  {
    name: "前置き・後書き・空行を含む",
    text: ["# meta", "# more", "a,b,c", "1,2,3", "", "4,5,6", "   ", "7,8,9", "# end", "sum"].join("\n"),
    options: { ...base, headerRow: 3, endRow: 8 },
  },
  {
    name: "引用符つきのセル",
    text: ['name,note', '"a,b","x ""y"" z"', 'c,"d"'].join("\n"),
    options: base,
  },
  {
    name: "連続区切りをまとめる固定幅出力",
    text: ["X   Y   Z", "1   2   3", "4   5   6"].join("\n"),
    options: { ...base, delimiter: "space", collapseConsecutive: true },
  },
  {
    name: "列数の食い違い（データ側が多い・少ない）",
    text: ["a,b", "1,2,3", "4,5,6", "7"].join("\n"),
    options: base,
  },
  {
    name: "区切りが空の custom（表にならない）",
    text: ["a,b", "1,2"].join("\n"),
    options: { ...base, delimiter: "custom", customDelimiter: "" },
  },
  {
    name: "範囲が不正（開始が終了より後）",
    text: ["a,b", "1,2", "3,4"].join("\n"),
    options: { ...base, headerRow: 3, endRow: 2 },
  },
  {
    name: "開始行がファイルの外",
    text: ["a,b", "1,2"].join("\n"),
    options: { ...base, headerRow: 10, endRow: 20 },
  },
  {
    name: "末尾に空行",
    text: "a,b\n1,2\n3,4\n\n\n",
    options: base,
  },
];

describe("parseDelimitedLines / countDataRows / parseDelimitedLinesAsync", () => {
  for (const c of EQUIV_CASES) {
    it(`${c.name}: parseDelimited と同じ結果になる`, async () => {
      const expected = parseDelimited(c.text, c.options);
      const lines = splitLines(c.text);
      expect(parseDelimitedLines(lines, c.options)).toEqual(expected);
      expect(await parseDelimitedLinesAsync(lines, c.options)).toEqual(expected);
      expect(countDataRows(lines, c.options)).toBe(expected.rows.length);
    });
  }

  it("非同期版は譲りながら進めても結果が同じ（sliceMs を極小にして必ず譲らせる）", async () => {
    const text = ["a,b", ...Array.from({ length: 2_000 }, (_, i) => `${i},${i * 2}`)].join("\n");
    const options = { ...base, endRow: 5_000 };
    const expected = parseDelimited(text, options);
    const actual = await parseDelimitedLinesAsync(splitLines(text), options, { sliceMs: 0 });
    expect(actual).toEqual(expected);
  });
});

describe("parseDelimitedSample", () => {
  const text = [
    "# pre",
    "a,b",
    ...Array.from({ length: 100 }, (_, i) => `${i},${i}`),
    "# post",
  ].join("\n");
  const options = { ...base, headerRow: 2, endRow: 102 };

  it("先頭から maxRows 行だけ変換する", () => {
    const sample = parseDelimitedSample(splitLines(text), options, 10);
    expect(sample.rows).toHaveLength(10);
    expect(sample.rows[0]).toEqual(["0", "0"]);
    expect(sample.rows[9]).toEqual(["9", "9"]);
  });

  it("headerLines / footerLines は全体の変換と同じ", () => {
    const full = parseDelimited(text, options);
    const sample = parseDelimitedSample(splitLines(text), options, 10);
    expect(sample.headers).toEqual(full.headers);
    expect(sample.headerLines).toEqual(full.headerLines);
    expect(sample.footerLines).toEqual(full.footerLines);
  });

  it("maxRows が行数より多ければ全体と同じ", () => {
    expect(parseDelimitedSample(splitLines(text), options, 1_000)).toEqual(parseDelimited(text, options));
  });

  it("空行は数えずに maxRows 行を集める", () => {
    const t = ["a,b", "1,1", "", "2,2", "3,3"].join("\n");
    const sample = parseDelimitedSample(splitLines(t), base, 2);
    expect(sample.rows).toEqual([["1", "1"], ["2", "2"]]);
  });
});
