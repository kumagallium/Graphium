import { describe, expect, it } from "vitest";
import { DOC_TABLE_DEFAULT_MAX_ROWS, DOC_TABLE_HARD_MAX_ROWS, defaultImportTarget } from "./target";

describe("defaultImportTarget", () => {
  it("区切りテキストの取り込みは行数に関係なくデータ表が既定", () => {
    expect(defaultImportTarget(0)).toBe("dataTable");
    expect(defaultImportTarget(47)).toBe("dataTable");
    expect(defaultImportTarget(2000)).toBe("dataTable");
  });

  it("文書の表を選んだときに注意を出す行数の目安は 200", () => {
    expect(DOC_TABLE_DEFAULT_MAX_ROWS).toBe(200);
  });

  it("文書の表にできる上限は 1,000 行（超えると取り込みを止めてデータ表へ誘導）", () => {
    expect(DOC_TABLE_HARD_MAX_ROWS).toBe(1000);
    expect(DOC_TABLE_HARD_MAX_ROWS).toBeGreaterThan(DOC_TABLE_DEFAULT_MAX_ROWS);
  });
});
