// 計算ブロックから参照する「表の列」の読み取り
import { describe, expect, it, beforeEach } from "vitest";
import {
  buildTableIndex,
  collectDataTableBlockIds,
  collectTableColumns,
  columnsFromText,
  collectTableRowNames,
  rowNamesFromText,
  publishTableColumns,
  readTableColumns,
  warmDataTableColumns,
  columnsFromTextAsync,
} from "./table-scope";
import { primeAssetText, clearAssetTextCache } from "../../features/data-import/asset-text";
import { clearDataTableCache, peekDataTableFromBlock } from "../data-table/data";
import { linkedColumnsFor, mergeLinkedColumns } from "../data-table/linked";
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
    // 数値として読めない列も行の数だけ null を持つ（列自体は残す）
    expect(columns.get("試料")).toEqual({ values: [null, null] });
  });

  it("単位表記が列内で揃っていないときは unit を付けない", () => {
    const columns = readTableColumns(
      table("t1", [["質量"], ["1 g"], ["2 kg"]])
    );
    // 列としては素の数値。1 セルを読む cell() 用にセルごとの単位だけ残す
    expect(columns.get("質量")).toEqual({ values: [1, 2], cellUnits: ["g", "kg"] });
  });

  it("単位の無い列は素の数値になる", () => {
    const columns = readTableColumns(table("t1", [["値"], ["1"], ["2"]]));
    expect(columns.get("値")).toEqual({ values: [1, 2] });
  });

  it("読めないセルは null で行の位置を残し、他の行の値と単位判定は残る", () => {
    const columns = readTableColumns(
      table("t1", [["値"], ["1 g"], ["未測定"], ["3 g"]])
    );
    expect(columns.get("値")).toEqual({ values: [1, null, 3], unit: "g" });
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

  it("同じデータ表を 2 回集めると列データは同じ参照（編集のたびに読み直さない）", () => {
    primeAssetText("asset-1", CSV);
    const blocks = [dataTable("dt", "oven-log")];
    const names = new Map([["dt", "oven-log"]]);
    const first = collectTableColumns(blocks as any, names).get("oven-log");
    const second = collectTableColumns(blocks as any, names).get("oven-log");
    expect(second).toBe(first);
    expect(second?.get("temp_c")).toBe(first?.get("temp_c"));
  });

  it("同じデータ表を 2 回集めると行の名前も同じ参照", () => {
    primeAssetText("asset-1", CSV);
    const blocks = [dataTable("dt", "oven-log")];
    const names = new Map([["dt", "oven-log"]]);
    const first = collectTableRowNames(blocks as any, names)["oven-log"];
    const second = collectTableRowNames(blocks as any, names)["oven-log"];
    expect(first.length).toBeGreaterThan(0);
    expect(second).toBe(first);
  });

  it("計算列があるときは毎回計算する（値は正しい）", () => {
    primeAssetText("asset-1", CSV);
    const blocks = [dataTable("dt", "oven-log")];
    const names = new Map([["dt", "oven-log"]]);
    const wb = { calc1: [{ tableBlockId: "dt", column: "d", texts: ["1", "2", "3"] }] };
    const first = collectTableColumns(blocks as any, names, wb).get("oven-log");
    const second = collectTableColumns(blocks as any, names, wb).get("oven-log");
    expect(second?.get("d")).toEqual({ values: [1, 2, 3] });
    expect(second).not.toBe(first);
  });

  it("本文の表は今までどおり毎回読む", () => {
    const blocks = [table("t", [["v"], ["1"]])];
    const names = new Map([["t", "表"]]);
    const first = collectTableColumns(blocks as any, names).get("表");
    const second = collectTableColumns(blocks as any, names).get("表");
    expect(second).not.toBe(first);
    expect(second).toEqual(first);
  });

  it("dataTable が未 prime なら列は出ない", () => {
    const blocks = [dataTable("dt", "oven-log")];
    const tables = collectTableColumns(blocks as any, new Map([["dt", "oven-log"]]));
    expect(tables.has("oven-log")).toBe(false);
  });

  it("calcWritebacks にこのデータ表宛ての宣言があれば計算列も列として含める", () => {
    primeAssetText("asset-1", CSV);
    const blocks = [dataTable("dt", "oven-log")];
    const calcWritebacks = { calc1: [{ tableBlockId: "dt", column: "d", texts: ["1", "2", "3"] }] };
    const tables = collectTableColumns(blocks as any, new Map([["dt", "oven-log"]]), calcWritebacks);
    expect(tables.get("oven-log")?.get("d")).toEqual({ values: [1, 2, 3] });
  });

  it("素材と同名の計算列は無視する（素材が勝つ）", () => {
    primeAssetText("asset-1", CSV);
    const blocks = [dataTable("dt", "oven-log")];
    // temp_c は素材側に既にある列名。書き戻し宣言があっても素材の値のまま
    const calcWritebacks = { calc1: [{ tableBlockId: "dt", column: "temp_c", texts: ["999", "999", "999"] }] };
    const tables = collectTableColumns(blocks as any, new Map([["dt", "oven-log"]]), calcWritebacks);
    expect(tables.get("oven-log")?.get("temp_c")).toEqual({ values: [180.0, 181.5, 183.0] });
  });
});

describe("columnsFromText", () => {
  it("数値列の values と unit を判定する", () => {
    const columns = columnsFromText(["質量"], [["1 g"], ["2 g"]]);
    expect(columns.get("質量")).toEqual({ values: [1, 2], unit: "g" });
  });

  it("読めないセルは null で行の位置を残す", () => {
    const columns = columnsFromText(["値"], [["1 g"], ["不明"], ["3 g"]]);
    expect(columns.get("値")).toEqual({ values: [1, null, 3], unit: "g" });
  });

  it("列ごとに空欄の位置が違っても、同じ行どうしが並ぶ", () => {
    const columns = columnsFromText(
      ["A", "B"],
      [["1", ""], ["", "20"], ["3", "30"]],
    );
    expect(columns.get("A")).toEqual({ values: [1, null, 3] });
    expect(columns.get("B")).toEqual({ values: [null, 20, 30] });
  });

  it("末尾の全部空の行は数えず、途中の空行は位置を保つ", () => {
    const columns = columnsFromText(
      ["値", "メモ"],
      [["1", "a"], ["", ""], ["3", ""], ["", " "], ["", ""]],
    );
    expect(columns.get("値")).toEqual({ values: [1, null, 3] });
  });

  it("指数表記の数値を読み、指数部を単位と取り違えない", () => {
    expect(columnsFromText(["zT"], [["8e-4"], ["0.0012"]]).get("zT")).toEqual({
      values: [0.0008, 0.0012],
    });
    expect(columnsFromText(["質量"], [["2e-3 g"], ["0.004 g"]]).get("質量")).toEqual({
      values: [0.002, 0.004],
      unit: "g",
    });
  });

  it("単位が揃っていなければ unit を付けない", () => {
    const columns = columnsFromText(["値"], [["1 g"], ["2 kg"]]);
    expect(columns.get("値")).toEqual({ values: [1, 2], cellUnits: ["g", "kg"] });
  });

  it("単位の付いたセルと付かないセルが混ざれば、付かないセルは空の単位", () => {
    const columns = columnsFromText(["量"], [["2 g"], [""], ["5"]]);
    expect(columns.get("量")).toEqual({ values: [2, null, 5], cellUnits: ["g", "", ""] });
  });
});

describe("rowNamesFromText / collectTableRowNames", () => {
  it("1 列目のテキストを行の名前にする（前後の空白は除く・末尾の空行は数えない）", () => {
    expect(rowNamesFromText([[" BaCO3 ", "1"], ["", "2"], ["TiO2", "3"], ["", ""]])).toEqual([
      "BaCO3",
      "",
      "TiO2",
    ]);
  });

  it("列データと同じ表を同じ表示名で集める（同名の表は先の方）", () => {
    const blocks = [
      table("t1", [["試薬", "MW"], ["BaCO3", "197.34"]]),
      table("t2", [["試薬", "MW"], ["SrCO3", "147.63"]]),
      table("t3", [["T", "κ"], ["300", "1.2"]]),
    ];
    const names = new Map([
      ["t1", "試薬表"],
      ["t2", "試薬表"],
      ["t3", "表 2"],
    ]);
    expect(collectTableRowNames(blocks, names)).toEqual({ 試薬表: ["BaCO3"], "表 2": ["300"] });
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
  it("setTableColumns / setTableBlockIds を呼び、dataTable の id も setTableBlockIds に含める（計算列の受け皿）", () => {
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
    expect(calledIds["oven-log"]).toBe("dt1");
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

  it("store.calcWritebacks を読んで計算列を含めて配り、setDataTableBlockIds に dataTable の id だけ渡す", () => {
    primeAssetText("asset-1", CSV);
    const blocks = [dataTable("dt1", "oven-log"), table("t1", [["v"], ["1"]])];
    const editor = { document: blocks };
    let calledColumns: any;
    let calledDataTableIds: any;
    const store = {
      getCaption: () => "",
      setTableColumns: (columns: any) => {
        calledColumns = columns;
      },
      setDataTableBlockIds: (ids: string[]) => {
        calledDataTableIds = ids;
      },
      calcWritebacks: { calc1: [{ tableBlockId: "dt1", column: "d", texts: ["1", "2", "3"] }] },
    };
    publishTableColumns(editor, store);
    expect(calledColumns["oven-log"]["d"]).toEqual({ values: [1, 2, 3] });
    // table（t1）の id は含めない。dataTable（dt1）だけ
    expect(calledDataTableIds).toEqual(["dt1"]);
  });

  it("setDataTableBlockIds が無い store でも落ちない", () => {
    primeAssetText("asset-1", CSV);
    const blocks = [dataTable("dt1", "oven-log")];
    const editor = { document: blocks };
    expect(() =>
      publishTableColumns(editor, { getCaption: () => "", setTableColumns: () => {} })
    ).not.toThrow();
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

describe("大きなデータ表の列の先読み", () => {
  // 単位の一致・混在・数値でないセル・同名の列・空の見出し・末尾の空行を含む表
  const headers = ["name", "mass", "amount", "note", "mass", ""];
  const body = [
    ["flour", "250 g", "1 g", "x", "9", "z"],
    ["water", "175 g", "2 mL", "", "8", "z"],
    ["salt", "5 g", "n/a", "y", "7", "z"],
    ["", "", "", "", "", ""],
  ];

  it("columnsFromTextAsync は columnsFromText と同じ結果を返す（譲る回数に関係なく）", async () => {
    const expected = [...columnsFromText(headers, body).entries()];
    expect(expected.length).toBeGreaterThan(0);
    expect([...(await columnsFromTextAsync(headers, body)).entries()]).toEqual(expected);
    expect([...(await columnsFromTextAsync(headers, body, { sliceMs: 0 })).entries()]).toEqual(expected);
  });

  it("行数が多くても同じ結果（途中で譲る）", async () => {
    const big = Array.from({ length: 5000 }, (_, i) => [String(i), `${i * 2} g`, i % 3 === 0 ? "" : "x"]);
    const h = ["i", "mass", "flag"];
    const expected = [...columnsFromText(h, big).entries()];
    expect([...(await columnsFromTextAsync(h, big, { sliceMs: 0 })).entries()]).toEqual(expected);
  });

  it("warmDataTableColumns の後は、同じ rows のデータ表を集めても読み直さない", async () => {
    primeAssetText("asset-1", CSV);
    const blocks = [dataTable("dt", "oven-log")];
    const names = new Map([["dt", "oven-log"]]);
    const data = peekDataTableFromBlock(blocks[0])!;
    await warmDataTableColumns(data.headers, data.rows);
    const first = collectTableColumns(blocks as any, names).get("oven-log")!;
    const second = collectTableColumns(blocks as any, names).get("oven-log")!;
    expect(second).toBe(first);
    expect([...first.entries()]).toEqual([...columnsFromText(data.headers, data.rows).entries()]);
    expect(collectTableRowNames(blocks as any, names)["oven-log"]).toEqual(rowNamesFromText(data.rows));
  });
});

describe("計算列つきのデータ表（素材の列を読み直さない）", () => {
  const names = new Map([["dt", "oven-log"]]);
  const wb = (...cols: [string, string[]][]) => ({
    calc1: cols.map(([column, texts]) => ({ tableBlockId: "dt", column, texts })),
  });
  // 変更前の経路（足した表を作って columnsFromText で全部読む）
  const viaMerge = (blocks: any[], writebacks: Record<string, unknown[]>) => {
    const raw = peekDataTableFromBlock(blocks[0])!;
    const merged = mergeLinkedColumns(raw, linkedColumnsFor("dt", writebacks))!;
    return {
      columns: columnsFromText(merged.data.headers, merged.data.rows),
      names: rowNamesFromText(merged.data.rows),
    };
  };
  const setup = (csv: string, endRow = 6) => {
    clearAssetTextCache();
    clearDataTableCache();
    primeAssetText("asset-1", csv);
    // 共有の dtSource は書き換えず、この describe 用の source を別に作る
    const source: TableSource = { ...dtSource, options: { ...dtSource.options, endRow } };
    return [{ id: "dt", type: "dataTable", props: { caption: "oven-log", source: serializeDataTableSource(source) }, children: [] }];
  };
  const entries = (m: Map<string, TableColumnData>) => [...m.entries()];

  const cases: [string, string, Record<string, unknown[]>][] = [
    ["数値と単位つき", CSV, wb(["質量", ["1 g", "2 g", "3 g"]], ["v", ["1", "x", "3"]])],
    ["空の計算列", CSV, wb(["空", ["", "", ""]])],
    ["行数より短い texts", CSV, wb(["短", ["1 g"]])],
    ["行数より長い texts", CSV, wb(["長", ["1", "2", "3", "4", "5"]])],
    ["素材と同名", CSV, wb(["temp_c", ["9", "9", "9"]], ["new", ["1", "2", "3"]])],
    ["計算列どうしの同名", CSV, { a: [{ tableBlockId: "dt", column: "d", texts: ["1", "2", "3"] }], b: [{ tableBlockId: "dt", column: "d", texts: ["7", "8", "9"] }] }],
    ["素材の末尾が全部空で計算列に値がある", "time,temp_c\n00:00,180.0\n,\n,", wb(["d", ["1", "2", "3"]])],
    ["素材の末尾が全部空で計算列も空", "time,temp_c\n00:00,180.0\n,\n,", wb(["d", ["1", "", ""]])],
  ];
  for (const [label, csv, writebacks] of cases) {
    it(`中身が変更前の経路と一致する: ${label}`, () => {
      const blocks = setup(csv);
      const expected = viaMerge(blocks, writebacks);
      expect(entries(collectTableColumns(blocks as any, names, writebacks).get("oven-log")!)).toEqual(
        entries(expected.columns),
      );
      expect(collectTableRowNames(blocks as any, names, writebacks)["oven-log"]).toEqual(expected.names);
    });
  }

  it("同じ宣言で 2 回集めると、素材の列も計算列も同じ参照", () => {
    const blocks = setup(CSV);
    const w1 = wb(["質量", ["1 g", "2 g", "3 g"]]);
    const w2 = wb(["質量", ["1 g", "2 g", "3 g"]]); // 中身は同じで配列は別
    const a = collectTableColumns(blocks as any, names, w1).get("oven-log")!;
    const b = collectTableColumns(blocks as any, names, w2).get("oven-log")!;
    expect(b.get("temp_c")).toBe(a.get("temp_c"));
    expect(b.get("質量")).toBe(a.get("質量"));
    const r1 = collectTableRowNames(blocks as any, names, w1)["oven-log"];
    expect(collectTableRowNames(blocks as any, names, w2)["oven-log"]).toBe(r1);
  });

  it("texts が 1 つ変わると、その計算列だけ新しくなる", () => {
    const blocks = setup(CSV);
    const a = collectTableColumns(blocks as any, names, wb(["x", ["1", "2", "3"]], ["y", ["4", "5", "6"]])).get("oven-log")!;
    const b = collectTableColumns(blocks as any, names, wb(["x", ["1", "2", "3"]], ["y", ["4", "5", "7"]])).get("oven-log")!;
    expect(b.get("temp_c")).toBe(a.get("temp_c"));
    expect(b.get("x")).toBe(a.get("x"));
    expect(b.get("y")).not.toBe(a.get("y"));
    expect(b.get("y")).toEqual({ values: [4, 5, 7] });
    expect(collectTableRowNames(blocks as any, names, wb(["x", ["9", "9", "9"]]))["oven-log"]).toBe(
      collectTableRowNames(blocks as any, names)["oven-log"],
    );
  });
});
