import { describe, it, expect, beforeEach } from "vitest";
import {
  peekDataTable,
  peekDataTableFromBlock,
  loadDataTable,
  subscribeDataTableData,
  clearDataTableCache,
  registerLargeTablePreparer,
} from "./data";
import { SYNC_PARSE_MAX_CHARS } from "../../features/data-import/large-file";
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

describe("大きな本文（SYNC_PARSE_MAX_CHARS 超）", () => {
  /** しきい値を超える本文。1 行 20 文字前後 × 十分な行数 */
  function bigText(): { text: string; rows: number } {
    const rows = Math.ceil(SYNC_PARSE_MAX_CHARS / 8) + 10;
    const lines = ["time,temp_c"];
    for (let i = 0; i < rows; i++) lines.push(`${i},${i % 100}`);
    return { text: lines.join("\n"), rows };
  }
  const bigSource = (rows: number) => source({ options: { ...source().options, endRow: rows + 1 } });

  it("peek は最初 null を返し、変換が終わると通知が 1 回来て、その後はデータを返す", async () => {
    const { text, rows } = bigText();
    expect(text.length).toBeGreaterThan(SYNC_PARSE_MAX_CHARS);
    primeAssetText("asset-1", text);
    let calls = 0;
    const unsubscribe = subscribeDataTableData(() => {
      calls += 1;
    });
    const src = bigSource(rows);
    expect(peekDataTable(src)).toBeNull();
    // 変換中に重ねて peek しても変換は 1 回（通知も 1 回）
    expect(peekDataTable(src)).toBeNull();
    await new Promise((r) => setTimeout(r, 1_500));
    expect(calls).toBe(1);
    const data = peekDataTable(src);
    expect(data?.headers).toEqual(["time", "temp_c"]);
    expect(data?.rows).toHaveLength(rows);
    unsubscribe();
  });

  it("load を重ねて呼んでも同じ結果オブジェクトになる", async () => {
    const { text, rows } = bigText();
    primeAssetText("asset-1", text);
    const src = bigSource(rows);
    const [a, b] = await Promise.all([loadDataTable(src), loadDataTable(src)]);
    expect(a).toBe(b);
    expect(a.rows).toHaveLength(rows);
    // 終わったあとの peek もキャッシュの同じオブジェクト
    expect(peekDataTable(src)).toBe(a);
  });
});

describe("registerLargeTablePreparer", () => {
  // SYNC_PARSE_MAX_CHARS（200 万文字）を超える本文
  const bigCsv = "a,b\n" + Array.from({ length: 260_000 }, (_, i) => `${i},${i * 2}`).join("\n") + "\n";
  const bigSource = () => source({ options: { ...source().options, endRow: 260_001 } });

  it("大きな表は、下ごしらえが済んでから「読めた」と知らせる", async () => {
    const order: string[] = [];
    const unregister = registerLargeTablePreparer(async (data) => {
      await new Promise((r) => setTimeout(r, 10));
      order.push(`prepared:${data.rows.length}`);
    });
    const unsubscribe = subscribeDataTableData(() => order.push("notified"));
    primeAssetText("asset-1", bigCsv);
    expect(peekDataTable(bigSource())).toBeNull();
    const data = await loadDataTable(bigSource());
    await new Promise((r) => setTimeout(r, 5));
    expect(data.rows.length).toBe(260_000);
    expect(order).toEqual(["prepared:260000", "notified"]);
    unregister();
    unsubscribe();
  });

  it("下ごしらえが失敗しても表は読める", async () => {
    const unregister = registerLargeTablePreparer(async () => {
      throw new Error("boom");
    });
    primeAssetText("asset-1", bigCsv);
    const data = await loadDataTable(bigSource());
    expect(data.headers).toEqual(["a", "b"]);
    unregister();
  });

  it("小さな表には下ごしらえを掛けない（同期で読む）", () => {
    let called = 0;
    const unregister = registerLargeTablePreparer(async () => {
      called += 1;
    });
    primeAssetText("asset-1", CSV);
    expect(peekDataTable(source())?.rows).toHaveLength(2);
    expect(called).toBe(0);
    unregister();
  });
});
