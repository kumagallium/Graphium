import { describe, it, expect } from "vitest";
import { parseDelimited, splitLine, splitLines, resolveDelimiter } from "./parse";
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

  it("見出しより列が多い行は切り落とす（表の列数を揃える）", () => {
    const result = parseDelimited("a,b\n1,2,3", { ...base, endRow: 2 });
    expect(result.rows).toEqual([["1", "2"]]);
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
