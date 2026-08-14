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
