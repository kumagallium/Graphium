import { describe, it, expect } from "vitest";
import { buildTableSource } from "./source";
import { detectImportOptions } from "./detect";
import { parseDelimited, splitLines } from "./parse";

const RAW = [
  "# [INSTRUMENT SETTINGS & METADATA]",
  "# Device Model: ENV-MONITOR-X9",
  "# Sampling Interval: 1 Day",
  "日付,最高気温,平均湿度",
  "8月1日,35.2,75",
  "8月2日,36.5,80",
].join("\n");

function importRaw(fileName = "log.dat", fileId?: string) {
  const options = detectImportOptions(splitLines(RAW));
  const parsed = parseDelimited(RAW, options);
  return buildTableSource({
    fileName,
    fileId,
    options,
    parsed,
    importedAt: "2026-08-14T00:00:00.000Z",
  });
}

describe("buildTableSource", () => {
  it("取り込み設定をそのまま来歴として残す", () => {
    expect(importRaw().options).toEqual({
      headerRow: 4,
      endRow: 6,
      delimiter: "comma",
      collapseConsecutive: false,
    });
  });

  it("前置きの測定条件を meta として残す", () => {
    expect(importRaw().meta).toEqual([
      { key: "Device Model", value: "ENV-MONITOR-X9" },
      { key: "Sampling Interval", value: "1 Day" },
    ]);
  });

  it("素材として登録済みなら fileId で元ファイルに辿れる", () => {
    expect(importRaw("log.dat", "file-1").fileId).toBe("file-1");
  });

  it("素材でなければ fileId は持たない（ファイル名だけ残る）", () => {
    const source = importRaw();
    expect(source.fileId).toBeUndefined();
    expect(source.fileName).toBe("log.dat");
  });

  it("保存した設定でパースし直すと同じ表になる（再取り込みの前提）", () => {
    const source = importRaw();
    const reparsed = parseDelimited(RAW, {
      ...source.options,
      customDelimiter: source.options.customDelimiter,
    });
    expect(reparsed.headers).toEqual(["日付", "最高気温", "平均湿度"]);
    expect(reparsed.rows).toHaveLength(2);
  });
});
