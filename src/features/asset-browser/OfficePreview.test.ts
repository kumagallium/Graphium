// OfficePreview の表示用の補助関数のテスト

import { describe, expect, it } from "vitest";
import { columnName, sheetPreviewRows, XLSX_PREVIEW_MAX_COLS, XLSX_PREVIEW_MAX_ROWS } from "./OfficePreview";

describe("columnName", () => {
  it("Excel と同じ列名にする", () => {
    expect([1, 2, 26, 27, 52, 53, 702, 703].map(columnName)).toEqual([
      "A", "B", "Z", "AA", "AZ", "BA", "ZZ", "AAA",
    ]);
  });
});

describe("sheetPreviewRows", () => {
  it("見出しは列名・行はそのまま。末尾の空行は落とす", () => {
    const result = sheetPreviewRows([["a", "b"], ["1", ""], ["", ""], ["", ""]]);
    expect(result.header).toEqual(["A", "B"]);
    expect(result.rows).toEqual([["a", "b"], ["1", ""]]);
    expect(result.totalRows).toBe(2);
    expect(result.totalCols).toBe(2);
  });

  it("途中の空行は残す（表の区切りとして意味があることがある）", () => {
    const result = sheetPreviewRows([["a"], [""], ["b"]]);
    expect(result.rows).toEqual([["a"], [""], ["b"]]);
  });

  it("行と列を上限で切り、切る前の数も返す", () => {
    const wide = Array.from({ length: XLSX_PREVIEW_MAX_COLS + 5 }, (_, i) => String(i));
    const cells = Array.from({ length: XLSX_PREVIEW_MAX_ROWS + 10 }, () => wide);
    const result = sheetPreviewRows(cells);
    expect(result.rows).toHaveLength(XLSX_PREVIEW_MAX_ROWS);
    expect(result.header).toHaveLength(XLSX_PREVIEW_MAX_COLS);
    expect(result.rows[0]).toHaveLength(XLSX_PREVIEW_MAX_COLS);
    expect(result.totalRows).toBe(XLSX_PREVIEW_MAX_ROWS + 10);
    expect(result.totalCols).toBe(XLSX_PREVIEW_MAX_COLS + 5);
  });

  it("空のシートは行も見出しも無い", () => {
    expect(sheetPreviewRows([])).toEqual({ header: [], rows: [], totalRows: 0, totalCols: 0 });
  });
});
