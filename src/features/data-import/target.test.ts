import { describe, it, expect } from "vitest";
import { defaultImportTarget, DOC_TABLE_DEFAULT_MAX_ROWS } from "./target";

describe("defaultImportTarget", () => {
  it("0 行は文書の表", () => {
    expect(defaultImportTarget(0)).toBe("table");
  });

  it("上限ちょうど（200 行）は文書の表", () => {
    expect(defaultImportTarget(DOC_TABLE_DEFAULT_MAX_ROWS)).toBe("table");
  });

  it("上限を 1 行超える（201 行）とデータ表", () => {
    expect(defaultImportTarget(DOC_TABLE_DEFAULT_MAX_ROWS + 1)).toBe("dataTable");
  });

  it("2,000 行はデータ表", () => {
    expect(defaultImportTarget(2000)).toBe("dataTable");
  });
});
