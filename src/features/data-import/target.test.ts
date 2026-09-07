import { describe, expect, it } from "vitest";
import { DOC_TABLE_DEFAULT_MAX_ROWS, defaultImportTarget } from "./target";

describe("defaultImportTarget", () => {
  it("区切りテキストの取り込みは行数に関係なくデータ表が既定", () => {
    expect(defaultImportTarget(0)).toBe("dataTable");
    expect(defaultImportTarget(47)).toBe("dataTable");
    expect(defaultImportTarget(2000)).toBe("dataTable");
  });

  it("文書の表を選んだときに注意を出す行数の目安は 200", () => {
    expect(DOC_TABLE_DEFAULT_MAX_ROWS).toBe(200);
  });
});
