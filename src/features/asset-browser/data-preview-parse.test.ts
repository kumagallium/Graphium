import { describe, expect, it } from "vitest";
import { parsePreviewText } from "./data-preview-parse";
import { SYNC_PARSE_MAX_CHARS } from "../data-import/large-file";
import { parseDelimited, splitLines } from "../data-import/parse";
import { detectImportOptions } from "../data-import/detect";

describe("parsePreviewText", () => {
  it("小さい本文は同期版と同じ結果", async () => {
    const text = "a,b\n1,2\n3,4\n";
    const lines = splitLines(text);
    const options = detectImportOptions(lines);
    expect(await parsePreviewText(text, lines, options)).toEqual(parseDelimited(text, options));
  });

  it("大きい本文は小分けの非同期で、同期版と同じ結果になる", async () => {
    const rowCount = Math.ceil(SYNC_PARSE_MAX_CHARS / 8) + 10;
    const text = "t,v\n" + Array.from({ length: rowCount }, (_, i) => `${i},${i % 7}`).join("\n") + "\n";
    expect(text.length).toBeGreaterThan(SYNC_PARSE_MAX_CHARS);
    const lines = splitLines(text);
    const options = detectImportOptions(lines);
    const parsed = await parsePreviewText(text, lines, options);
    expect(parsed.rows).toHaveLength(rowCount);
    expect(parsed.headers).toEqual(["t", "v"]);
    expect(parsed.rows[rowCount - 1]).toEqual([String(rowCount - 1), String((rowCount - 1) % 7)]);
  });
});

import { limitPreviewTable } from "./data-preview-parse";
import { XLSX_PREVIEW_MAX_COLS, XLSX_PREVIEW_MAX_ROWS } from "./OfficePreview";

describe("limitPreviewTable", () => {
  it("上限以下は同じ配列のまま返し、切らない", () => {
    const headers = ["a", "b"];
    const rows = [["1", "2"]];
    const r = limitPreviewTable(headers, rows);
    expect(r.cut).toBe(false);
    expect(r.header).toBe(headers);
    expect(r.rows).toBe(rows);
  });

  it("ちょうど上限は切らない", () => {
    const rows = Array.from({ length: XLSX_PREVIEW_MAX_ROWS }, () => ["1"]);
    expect(limitPreviewTable(["a"], rows).cut).toBe(false);
  });

  it("行が上限を超えたら先頭の上限行だけにする", () => {
    const rows = Array.from({ length: XLSX_PREVIEW_MAX_ROWS + 5 }, (_, i) => [String(i)]);
    const r = limitPreviewTable(["a"], rows);
    expect(r.cut).toBe(true);
    expect(r.rows).toHaveLength(XLSX_PREVIEW_MAX_ROWS);
    expect(r.rows[0]).toEqual(["0"]);
  });

  it("列が上限を超えたら先頭の上限列だけにする", () => {
    const headers = Array.from({ length: XLSX_PREVIEW_MAX_COLS + 3 }, (_, i) => `c${i}`);
    const r = limitPreviewTable(headers, [headers.map((_, i) => String(i))]);
    expect(r.cut).toBe(true);
    expect(r.header).toHaveLength(XLSX_PREVIEW_MAX_COLS);
    expect(r.rows[0]).toHaveLength(XLSX_PREVIEW_MAX_COLS);
  });
});
