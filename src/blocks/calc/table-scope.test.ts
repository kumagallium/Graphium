// 計算ブロックから参照する「表の列」の読み取り
import { describe, expect, it } from "vitest";
import {
  buildTableIndex,
  collectTableColumns,
  makeColumnLookup,
  readTableColumns,
} from "./table-scope";

const cell = (text: string) => [{ type: "text", text, styles: {} }];
const table = (id: string, rows: string[][]) => ({
  id,
  type: "table",
  content: { type: "tableContent", rows: rows.map((r) => ({ cells: r.map(cell) })) },
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
    expect(columns.get("質量")).toEqual([0.5, 0.33]);
    expect(columns.get("モル質量")).toEqual([197.34, 79.87]);
    // 数値として読めない列は空配列（列自体は残す）
    expect(columns.get("試料")).toEqual([]);
  });

  it("読めないセルは飛ばし、他の行の値は残す", () => {
    const columns = readTableColumns(
      table("t1", [["値"], ["1"], ["未測定"], ["3"]])
    );
    expect(columns.get("値")).toEqual([1, 3]);
  });

  it("ヘッダだけ・空の表は列を作らない", () => {
    expect(readTableColumns(table("t1", [["a", "b"]])).size).toBe(0);
    expect(readTableColumns({ type: "paragraph" }).size).toBe(0);
  });

  it("同名の列は最初の 1 つを採る", () => {
    const columns = readTableColumns(table("t1", [["x", "x"], ["1", "2"]]));
    expect(columns.get("x")).toEqual([1]);
  });
});

describe("collectTableColumns", () => {
  it("名前の付いた表だけを、子ブロックの中まで探して集める", () => {
    const blocks = [
      table("named", [["質量"], ["1.5"]]),
      { id: "s1", type: "step", children: [table("nested", [["温度"], ["900"]])] },
      table("anon", [["値"], ["7"]]),
    ];
    const names = new Map([
      ["named", "秤量表"],
      ["nested", "焼成条件"],
    ]);
    const tables = collectTableColumns(blocks as any, names);
    expect([...tables.keys()].sort()).toEqual(["焼成条件", "秤量表"]);
    expect(tables.get("秤量表")?.get("質量")).toEqual([1.5]);
    expect(tables.get("焼成条件")?.get("温度")).toEqual([900]);
  });

  it("同じ名前の表が 2 つあるときは文書順で先の方を採る", () => {
    const blocks = [table("a", [["v"], ["1"]]), table("b", [["v"], ["2"]])];
    const tables = collectTableColumns(blocks as any, new Map([["a", "表"], ["b", "表"]]));
    expect(tables.get("表")?.get("v")).toEqual([1]);
  });
});

describe("buildTableIndex", () => {
  it("日本語の表名・列名でも文字列キーで引ける形にする", () => {
    const tables = new Map([
      ["秤量表", new Map([["質量", [1, 2]], ["備考 2", [3]]])],
      ["表 1", new Map([["値", [9]]])],
    ]);
    const index = buildTableIndex(tables);
    // mathjs では 表["秤量表"]["質量"] として読む（識別子は ASCII 限定のため）
    expect(index["秤量表"]["質量"]).toEqual([1, 2]);
    // 空白入りの名前も落とさない（文字列キーなので書ける）
    expect(index["秤量表"]["備考 2"]).toEqual([3]);
    expect(index["表 1"]["値"]).toEqual([9]);
  });
});

describe("makeColumnLookup", () => {
  const tables = new Map([["表 1", new Map([["備考 2", [4, 5]]])]]);
  const lookup = makeColumnLookup(tables);

  it("表名・列名を文字列で渡して引ける", () => {
    expect(lookup("表 1", "備考 2")).toEqual([4, 5]);
  });

  it("無い表・無い列は理由が分かるエラーになる", () => {
    expect(() => lookup("無い表", "備考 2")).toThrow(/table not found/);
    expect(() => lookup("表 1", "無い列")).toThrow(/column not found/);
  });
});
