import { describe, expect, it } from "vitest";
import { migrateTableMeta } from "./migration";

/** ヘッダ 2 列 + 空のデータ行 1 つを持つテーブルブロック（旧 inline 配列形式のセル） */
function tableBlock(id: string, firstHeader: string) {
  const cell = (text: string) => [{ type: "text", text, styles: {} }];
  return {
    id,
    type: "table",
    content: {
      type: "tableContent",
      rows: [
        { cells: [cell(firstHeader), cell("値")] },
        { cells: [cell(""), cell("")] },
      ],
    },
  };
}

/** 新しい tableCell 形式のセルを持つテーブルブロック */
function tableCellBlock(id: string, firstHeader: string) {
  const cell = (text: string) => ({
    type: "tableCell",
    content: [{ type: "text", text, styles: {} }],
    props: {},
  });
  return {
    id,
    type: "table",
    content: {
      type: "tableContent",
      rows: [{ cells: [cell(firstHeader), cell("値")] }],
    },
  };
}

describe("migrateTableMeta", () => {
  it("記録テーブルを先頭列の datetime-auto に変換し、名前をキャプションへ移す", () => {
    const result = migrateTableMeta({
      blocks: [tableBlock("t1", "日時")],
      logTables: { t1: { name: "血圧の記録" } },
    });
    expect(result).toEqual({
      t1: { columns: { 日時: ["datetime-auto"] }, caption: "血圧の記録" },
    });
  });

  it("名前が無い記録テーブルはキャプションを持たない", () => {
    const result = migrateTableMeta({
      blocks: [tableBlock("t1", "日時")],
      logTables: { t1: {} },
    });
    expect(result).toEqual({ t1: { columns: { 日時: ["datetime-auto"] } } });
  });

  it("インデックステーブルを先頭列の note-link と noteLinks に変換する", () => {
    const result = migrateTableMeta({
      blocks: [tableBlock("t1", "名前")],
      indexTables: { t1: { 試料A: "note-1", 試料B: "note-2" } },
    });
    expect(result).toEqual({
      t1: {
        columns: { 名前: ["note-link"] },
        noteLinks: { 試料A: "note-1", 試料B: "note-2" },
      },
    });
  });

  it("紐付けが空のインデックステーブルは noteLinks を持たない", () => {
    const result = migrateTableMeta({
      blocks: [tableBlock("t1", "名前")],
      indexTables: { t1: {} },
    });
    expect(result).toEqual({ t1: { columns: { 名前: ["note-link"] } } });
  });

  it("両方が付いたテーブルは同じ列に 2 つのふるまいが並ぶ", () => {
    const result = migrateTableMeta({
      blocks: [tableBlock("t1", "日時")],
      logTables: { t1: {} },
      indexTables: { t1: { "2026-08-13 10:00": "note-1" } },
    });
    expect(result).toEqual({
      t1: {
        columns: { 日時: ["datetime-auto", "note-link"] },
        noteLinks: { "2026-08-13 10:00": "note-1" },
      },
    });
  });

  it("tableMeta があれば旧フィールドは無視する（新形式が唯一の真実）", () => {
    const result = migrateTableMeta({
      blocks: [tableBlock("t1", "日時")],
      tableMeta: { t1: { caption: "新形式" } },
      logTables: { t2: { name: "旧形式" } },
    });
    expect(result).toEqual({ t1: { caption: "新形式" } });
  });

  it("旧フィールドが無ければ undefined を返す", () => {
    expect(migrateTableMeta({ blocks: [tableBlock("t1", "日時")] })).toBeUndefined();
    expect(migrateTableMeta({ blocks: [], logTables: {}, indexTables: {} })).toBeUndefined();
    expect(migrateTableMeta(undefined)).toBeUndefined();
  });

  it("入れ子のブロックにあるテーブルからも列名を拾う", () => {
    const result = migrateTableMeta({
      blocks: [
        { id: "step1", type: "step", children: [tableBlock("t1", "測定日")] },
      ],
      logTables: { t1: {} },
    });
    expect(result).toEqual({ t1: { columns: { 測定日: ["datetime-auto"] } } });
  });

  it("tableCell 形式のセルからも列名を拾う", () => {
    const result = migrateTableMeta({
      blocks: [tableCellBlock("t1", "観察日")],
      logTables: { t1: {} },
    });
    expect(result).toEqual({ t1: { columns: { 観察日: ["datetime-auto"] } } });
  });

  it("ヘッダが空・ブロックが見つからない場合は空文字キーになる（先頭列固定なので実害は無い）", () => {
    expect(
      migrateTableMeta({ blocks: [tableBlock("t1", "")], logTables: { t1: {} } })
    ).toEqual({ t1: { columns: { "": ["datetime-auto"] } } });
    expect(migrateTableMeta({ blocks: [], logTables: { missing: {} } })).toEqual({
      missing: { columns: { "": ["datetime-auto"] } },
    });
  });
});
