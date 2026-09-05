import { describe, it, expect, beforeEach } from "vitest";
import {
  peekDataTable,
  peekDataTableFromBlock,
  loadDataTable,
  subscribeDataTableData,
  clearDataTableCache,
} from "./data";
import { primeAssetText, clearAssetTextCache } from "../../features/data-import/asset-text";
import { serializeDataTableSource } from "./source";
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

function dataTableBlock(overrides: Partial<TableSource> = {}) {
  return {
    id: "dt1",
    type: "dataTable",
    props: { caption: "", source: serializeDataTableSource(source(overrides)) },
    children: [],
  };
}

describe("peekDataTableFromBlock", () => {
  it("dataTable 以外のブロックは null", () => {
    expect(peekDataTableFromBlock({ id: "t1", type: "table" })).toBeNull();
    expect(peekDataTableFromBlock(null)).toBeNull();
  });

  it("prime されていなければ null", () => {
    expect(peekDataTableFromBlock(dataTableBlock())).toBeNull();
  });

  it("prime 済みなら headers / rows を返す", () => {
    primeAssetText("asset-1", CSV);
    const data = peekDataTableFromBlock(dataTableBlock());
    expect(data?.headers).toEqual(["time", "temp_c"]);
    expect(data?.rows).toEqual([
      ["08:00", "180"],
      ["08:05", "182"],
    ]);
  });
});

describe("subscribeDataTableData", () => {
  it("素材が新しく読めたとき、非同期に 1 回通知する", async () => {
    const listener = () => {
      calls += 1;
    };
    let calls = 0;
    const unsubscribe = subscribeDataTableData(listener);
    primeAssetText("asset-1", CSV);
    peekDataTable(source()); // 初回パースで notifyArrived が走る
    expect(calls).toBe(0); // まだ同期では呼ばれない
    await new Promise((r) => setTimeout(r, 5));
    expect(calls).toBe(1);
    unsubscribe();
  });

  it("解除後は呼ばれない", async () => {
    let calls = 0;
    const unsubscribe = subscribeDataTableData(() => {
      calls += 1;
    });
    unsubscribe();
    primeAssetText("asset-1", CSV);
    peekDataTable(source());
    await new Promise((r) => setTimeout(r, 5));
    expect(calls).toBe(0);
  });

  it("キャッシュヒット（2 回目の peek）では通知しない", async () => {
    let calls = 0;
    primeAssetText("asset-1", CSV);
    peekDataTable(source()); // 1 回目でキャッシュに積む
    const unsubscribe = subscribeDataTableData(() => {
      calls += 1;
    });
    peekDataTable(source()); // 2 回目はキャッシュヒット
    await new Promise((r) => setTimeout(r, 5));
    expect(calls).toBe(0);
    unsubscribe();
  });
});
