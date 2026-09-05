import { describe, it, expect, beforeEach } from "vitest";
import { peekDataTable, loadDataTable, clearDataTableCache } from "./data";
import { primeAssetText, clearAssetTextCache } from "../../features/data-import/asset-text";
import type { TableSource } from "../../lib/document-types";

function source(overrides: Partial<TableSource> = {}): TableSource {
  return {
    kind: "delimited-file",
    fileName: "oven-log.csv",
    fileId: "asset-1",
    importedAt: "2026-09-05T00:00:00.000Z",
    options: {
      headerRow: 1,
      endRow: 3,
      delimiter: "comma",
      collapseConsecutive: false,
    },
    ...overrides,
  };
}

const CSV = "time,temp_c\n08:00,180\n08:05,182\n";

beforeEach(() => {
  clearAssetTextCache();
  clearDataTableCache();
});

describe("peekDataTable", () => {
  it("本文が prime されていなければ null", () => {
    expect(peekDataTable(source())).toBeNull();
  });

  it("prime 済みなら headers / rows を同期で返す", () => {
    primeAssetText("asset-1", CSV);
    const data = peekDataTable(source());
    expect(data?.headers).toEqual(["time", "temp_c"]);
    expect(data?.rows).toEqual([
      ["08:00", "180"],
      ["08:05", "182"],
    ]);
  });

  it("同じ source で 2 回 peek すると同一オブジェクトを返す（キャッシュ）", () => {
    primeAssetText("asset-1", CSV);
    const first = peekDataTable(source());
    const second = peekDataTable(source());
    expect(first).toBe(second);
  });

  it("options が違えば別の結果になる（キャッシュキーに options を含む）", () => {
    primeAssetText("asset-1", CSV);
    const withHeaderRow1 = peekDataTable(source());
    const withEndRow2 = peekDataTable(source({ options: { ...source().options, endRow: 2 } }));
    expect(withHeaderRow1).not.toBe(withEndRow2);
    expect(withEndRow2?.rows).toEqual([["08:00", "180"]]);
  });

  it("fileId が無ければ null", () => {
    const { fileId, ...rest } = source();
    expect(peekDataTable(rest as TableSource)).toBeNull();
  });
});

describe("loadDataTable", () => {
  it("fileId が無ければ reject する", async () => {
    const { fileId, ...rest } = source();
    await expect(loadDataTable(rest as TableSource)).rejects.toThrow();
  });

  it("prime 済みなら resolve して headers / rows を返す", async () => {
    primeAssetText("asset-1", CSV);
    const data = await loadDataTable(source());
    expect(data.headers).toEqual(["time", "temp_c"]);
    expect(data.rows).toHaveLength(2);
  });
});
