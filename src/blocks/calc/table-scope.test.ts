// 計算ブロックから参照する「表の列」の読み取り
import { describe, expect, it, beforeEach } from "vitest";
import {
  buildTableIndex,
  collectDataTableBlockIds,
  collectTableColumns,
  columnsFromText,
  publishTableColumns,
  readTableColumns,
} from "./table-scope";
import { primeAssetText, clearAssetTextCache } from "../../features/data-import/asset-text";
import { clearDataTableCache } from "../data-table/data";
import { serializeDataTableSource } from "../data-table/source";
import type { TableColumnData } from "../../features/table-meta/types";
import type { TableSource } from "../../lib/document-types";

const cell = (text: string) => [{ type: "text", text, styles: {} }];
const table = (id: string, rows: string[][]) => ({
  id,
  type: "table",
  content: { type: "tableContent", rows: rows.map((r) => ({ cells: r.map(cell) })) },
});

const dtSource: TableSource = {
  kind: "delimited-file",
  fileName: "oven-log.csv",
  fileId: "asset-1",
  importedAt: "2026-09-05T00:00:00.000Z",
  options: { headerRow: 1, endRow: 4, delimiter: "comma", collapseConsecutive: false },
};
const dataTable = (id: string, caption: string, children: any[] = []) => ({
  id,
  type: "dataTable",
  props: { caption, source: serializeDataTableSource(dtSource) },
  children,
});
const CSV = "time,temp_c\n00:00,180.0\n00:01,181.5\n00:02,183.0";

beforeEach(() => {
  clearAssetTextCache();
  clearDataTableCache();
});

describe("readTableColumns", () => {
  it("1 行目をヘッダにして列ごとの数値を集める（単位付きも読む）", () => {
    const columns = readTableColumns(
      table("t1", [
        ["試料", "質量", "モル質量"],
        ["BaCO3", "0.50 g", "197.34 g/mol"],
        ["TiO2", "0.33 g", "79.87 g/mol"],
      ])
    );
    expect(columns.get("質量")).toEqual({ values: [0.5, 0.33], unit: "g" });
    expect(columns.get("モル質量")).toEqual({ values: [197.34, 79.87], unit: "g/mol" });
    // 数値として読めない列は空配列（列自体は残す）
    expect(columns.get("試料")).toEqual({ values: [] });
  });

  it("単位表記が列内で揃っていないときは unit を付けない", () => {
    const columns = readTableColumns(
      table("t1", [["質量"], ["1 g"], ["2 kg"]])
    );
    expect(columns.get("質量")).toEqual({ values: [1, 2] });
  });

  it("単位の無い列は素の数値になる", () => {
    const columns = readTableColumns(table("t1", [["値"], ["1"], ["2"]]));
    expect(columns.get("値")).toEqual({ values: [1, 2] });
  });

  it("読めないセルは飛ばし、他の行の値と単位判定は残る", () => {
    const columns = readTableColumns(
      table("t1", [["値"], ["1 g"], ["未測定"], ["3 g"]])
    );
    expect(columns.get("値")).toEqual({ values: [1, 3], unit: "g" });
  });

  it("ヘッダだけ・空の表は列を作らない", () => {
    expect(readTableColumns(table("t1", [["a", "b"]])).size).toBe(0);
    expect(readTableColumns({ type: "paragraph" }).size).toBe(0);
  });

  it("同名の列は最初の 1 つを採る", () => {
    const columns = readTableColumns(table("t1", [["x", "x"], ["1", "2"]]));
    expect(columns.get("x")).toEqual({ values: [1] });
  });
});

describe("collectTableColumns", () => {
  it("表示名の付いた表を、子ブロックの中まで探して集める", () => {
    const blocks = [
      table("named", [["質量"], ["1.5"]]),
      { id: "s1", type: "step", children: [table("nested", [["温度"], ["900"]])] },
    ];
    const names = new Map([
      ["named", "秤量表"],
      ["nested", "焼成条件"],
    ]);
    const tables = collectTableColumns(blocks as any, names);
    expect([...tables.keys()].sort()).toEqual(["焼成条件", "秤量表"]);
    expect(tables.get("秤量表")?.get("質量")).toEqual({ values: [1.5] });
    expect(tables.get("焼成条件")?.get("温度")).toEqual({ values: [900] });
  });

  it("同じ名前の表が 2 つあるときは文書順で先の方を採る", () => {
    const blocks = [table("a", [["v"], ["1"]]), table("b", [["v"], ["2"]])];
    const tables = collectTableColumns(blocks as any, new Map([["a", "表"], ["b", "表"]]));
    expect(tables.get("表")?.get("v")).toEqual({ values: [1] });
  });

  it("dataTable は素材が prime 済みなら列を出す", () => {
    primeAssetText("asset-1", CSV);
    const blocks = [dataTable("dt", "oven-log")];
    const tables = collectTableColumns(blocks as any, new Map([["dt", "oven-log"]]));
    expect(tables.get("oven-log")?.get("temp_c")).toEqual({ values: [180.0, 181.5, 183.0] });
  });

  it("dataTable が未 prime なら列は出ない", () => {
    const blocks = [dataTable("dt", "oven-log")];
    const tables = collectTableColumns(blocks as any, new Map([["dt", "oven-log"]]));
    expect(tables.has("oven-log")).toBe(false);
  });
});

describe("columnsFromText", () => {
  it("数値列の values と unit を判定する", () => {
    const columns = columnsFromText(["質量"], [["1 g"], ["2 g"]]);
    expect(columns.get("質量")).toEqual({ values: [1, 2], unit: "g" });
  });

  it("読めないセルは飛ばす", () => {
    const columns = columnsFromText(["値"], [["1 g"], ["不明"], ["3 g"]]);
    expect(columns.get("値")).toEqual({ values: [1, 3], unit: "g" });
  });

  it("単位が揃っていなければ unit を付けない", () => {
    const columns = columnsFromText(["値"], [["1 g"], ["2 kg"]]);
    expect(columns.get("値")).toEqual({ values: [1, 2] });
  });
});

describe("collectDataTableBlockIds", () => {
  it("トップレベルの dataTable の id を集める", () => {
    const blocks = [dataTable("dt1", "a"), table("t1", [["v"], ["1"]])];
    expect(collectDataTableBlockIds(blocks as any)).toEqual(new Set(["dt1"]));
  });

  it("children（カラム内）の dataTable も拾う", () => {
    const nested = dataTable("dt2", "b");
    const blocks = [
      { id: "col1", type: "column", children: [nested] },
      dataTable("dt1", "a"),
    ];
    expect(collectDataTableBlockIds(blocks as any)).toEqual(new Set(["dt1", "dt2"]));
  });
});

describe("publishTableColumns", () => {
  it("setTableColumns / setTableBlockIds を呼び、dataTable の id は setTableBlockIds に含めない", () => {
    primeAssetText("asset-1", CSV);
    const blocks = [dataTable("dt1", "oven-log"), table("t1", [["v"], ["1"]])];
    const editor = { document: blocks };
    const setTableColumns = (columns: any) => {
      calledColumns = columns;
    };
    const setTableBlockIds = (ids: any) => {
      calledIds = ids;
    };
    let calledColumns: any;
    let calledIds: any;
    const store = { getCaption: () => "", setTableColumns, setTableBlockIds };
    publishTableColumns(editor, store);
    expect(calledColumns["oven-log"]["temp_c"]).toEqual({ values: [180.0, 181.5, 183.0] });
    expect(calledIds).not.toHaveProperty("oven-log");
    // 無名の table は自動名で登録される
    expect(Object.values(calledIds)).toContain("t1");
  });

  it("editor.document が無ければ何もしない", () => {
    let called = false;
    publishTableColumns({}, {
      getCaption: () => "",
      setTableColumns: () => {
        called = true;
      },
    });
    expect(called).toBe(false);
  });
});

describe("buildTableIndex", () => {
  it("日本語の表名・列名でも文字列キーで引ける形にする", () => {
    const col = (values: number[], unit?: string): TableColumnData =>
      unit ? { values, unit } : { values };
    const tables = new Map([
      ["秤量表", new Map([["質量", col([1, 2], "g")], ["備考 2", col([3])]])],
      ["表 1", new Map([["値", col([9])]])],
    ]);
    const index = buildTableIndex(tables);
    // mathjs では 表["秤量表"]["質量"] として読む（識別子は ASCII 限定のため）
    expect(index["秤量表"]["質量"]).toEqual({ values: [1, 2], unit: "g" });
    // 空白入りの名前も落とさない（文字列キーなので書ける）
    expect(index["秤量表"]["備考 2"]).toEqual({ values: [3] });
    expect(index["表 1"]["値"]).toEqual({ values: [9] });
  });
});
