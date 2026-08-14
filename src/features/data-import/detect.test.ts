import { describe, it, expect } from "vitest";
import { detectImportOptions } from "./detect";
import { splitLines, parseDelimited } from "./parse";

function detect(text: string) {
  return detectImportOptions(splitLines(text));
}

describe("detectImportOptions", () => {
  it("装置ファイルのヘッダー・フッターを外してデータ範囲を当てる", () => {
    const text = [
      "# [INSTRUMENT SETTINGS & METADATA]",
      "# Device Model: ENV-MONITOR-X9",
      "# Location: Site B",
      "# --------------------------",
      "# [DATA START]",
      "日付,最高気温,平均湿度,地点",
      "8月1日,35.2,75,地点B",
      "8月2日,36.5,80,地点B",
      "8月3日,34.8,85,地点B",
      "# [DATA END]",
    ].join("\n");
    const options = detect(text);
    expect(options).toMatchObject({
      headerRow: 6,
      endRow: 9,
      delimiter: "comma",
      collapseConsecutive: false,
    });
  });

  it("推定した設定でそのままパースすると表になる", () => {
    const text = ["# meta", "a,b", "1,2", "3,4"].join("\n");
    const parsed = parseDelimited(text, detect(text));
    expect(parsed.headers).toEqual(["a", "b"]);
    expect(parsed.rows).toEqual([["1", "2"], ["3", "4"]]);
  });

  it("タブ区切りを当てる", () => {
    const text = "title\nx\ty\n1\t2\n3\t4";
    expect(detect(text)).toMatchObject({ delimiter: "tab", headerRow: 2, endRow: 4 });
  });

  it("空白揃えの固定幅出力は space + collapse を当てる", () => {
    const text = [
      "! Spectrometer log",
      "! ---------------",
      "WAVELENGTH   INTENSITY   NOISE",
      "400.0        1023.5      2.1",
      "401.0        1044.2      2.0",
      "402.0        1099.8      1.9",
    ].join("\n");
    expect(detect(text)).toMatchObject({
      delimiter: "space",
      collapseConsecutive: true,
      headerRow: 3,
      endRow: 6,
    });
  });

  it("末尾の空行は終了行に含めない", () => {
    const text = "a,b\n1,2\n3,4\n\n\n";
    expect(detect(text).endRow).toBe(3);
  });

  it("区切りらしい構造が無ければ全行・カンマに倒す", () => {
    const text = "ただの文章です\nもう一行\n三行目";
    expect(detect(text)).toMatchObject({
      headerRow: 1,
      endRow: 3,
      delimiter: "comma",
    });
  });

  it("前置きにカンマを含むコメント行があってもデータ範囲に飲み込まない", () => {
    const text = [
      "# Columns: date, temp, humidity",
      "# Units: -, degC, %",
      "date,temp,humidity",
      "2026-08-01,35.2,75",
      "2026-08-02,36.5,80",
    ].join("\n");
    expect(detect(text)).toMatchObject({ headerRow: 3, endRow: 5 });
  });

  it("値に区切り文字が混ざって列数がずれる見出し行も範囲に含める", () => {
    // (hkl) 列の (0,0,2) がカンマで割れるため、列数一定の塊はデータ行だけになる。
    // それでも直前の見出し行を拾えること
    const text = [
      "# XRD pattern",
      "# Wavelength: 1.5406 A",
      "2theta,d,I,(hkl)",
      "21.34,4.161,5.0,(0,0,2)",
      "25.87,3.441,11.5,(1,0,1)",
      "33.51,2.672,2.7,(1,1,0)",
    ].join("\n");
    const options = detect(text);
    expect(options.headerRow).toBe(3);
    expect(options.endRow).toBe(6);
    const parsed = parseDelimited(text, options);
    expect(parsed.headers).toEqual(["2theta", "d", "I", "(hkl)", "", ""]);
    // 値は 1 つも欠けない
    expect(parsed.rows[0]).toEqual(["21.34", "4.161", "5.0", "(0", "0", "2)"]);
  });

  it("見出しの直前がコメント行なら範囲を広げない", () => {
    const text = ["# [DATA START]", "a,b", "1,2", "3,4"].join("\n");
    expect(detect(text).headerRow).toBe(2);
  });

  it("セミコロン区切り（欧州系 CSV）を当てる", () => {
    const text = "a;b;c\n1;2;3\n4;5;6";
    expect(detect(text)).toMatchObject({
      delimiter: "custom",
      customDelimiter: ";",
      headerRow: 1,
      endRow: 3,
    });
  });
});
