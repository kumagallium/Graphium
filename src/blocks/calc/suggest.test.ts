// 表参照の入力補完（computeCalcSuggestion / applyCalcSuggestion）
import { describe, expect, it } from "vitest";
import { applyCalcSuggestion, computeCalcSuggestion } from "./suggest";
import type { TableColumnsIndex } from "../../features/table-meta/types";

const tables: TableColumnsIndex = {
  秤量表: { 質量: { values: [1] }, モル質量: { values: [2] } },
  "表 1": { 値: { values: [3] } },
};

/** caret 省略時は末尾 */
const at = (text: string) => computeCalcSuggestion(text, text.length, tables);

describe("computeCalcSuggestion", () => {
  it("table[ の直後で表名の候補が出る（引用符はまだ無くてよい）", () => {
    const s = at("sum(table[");
    expect(s?.kind).toBe("table");
    expect(s?.style).toBe("index");
    expect(s?.items.sort()).toEqual(["秤量表", "表 1"].sort());
  });

  it("入力途中の文字列で候補が絞られる", () => {
    const s = at('sum(table["秤');
    expect(s?.items).toEqual(["秤量表"]);
  });

  it("表名確定後の 2 つ目の [ で、その表の列名候補が出る", () => {
    const s = at('sum(table["秤量表"]["');
    expect(s?.kind).toBe("column");
    expect(s?.tableName).toBe("秤量表");
    expect(s?.items.sort()).toEqual(["モル質量", "質量"].sort());
  });

  it("col( でも同じ流れで補完できる", () => {
    expect(at("col(")?.kind).toBe("table");
    expect(at("col(")?.style).toBe("call");
    const s = at('col("秤量表", "');
    expect(s?.kind).toBe("column");
    expect(s?.style).toBe("call");
    expect(s?.tableName).toBe("秤量表");
  });

  it("補完文脈でないとき・候補ゼロのときは null", () => {
    expect(at("1 + 2")).toBeNull();
    expect(at('sum(table["無い表名')).toBeNull();
    expect(computeCalcSuggestion("table[", 0, tables)).toBeNull();
    expect(at("table[")).not.toBeNull();
    expect(computeCalcSuggestion("table[", 6, null)).toBeNull();
  });

  it("caret のある行だけで判定する（前の行の table[ に反応しない）", () => {
    expect(at("table[\n1 + 2")).toBeNull();
  });
});

describe("applyCalcSuggestion", () => {
  it("表名の確定は次の列名入力へ繋がる形まで入れる", () => {
    const text = "sum(table[秤";
    const s = computeCalcSuggestion(text, text.length, tables)!;
    const r = applyCalcSuggestion(text, text.length, s, "秤量表");
    expect(r.text).toBe('sum(table["秤量表"]["');
    expect(r.caret).toBe(r.text.length);
  });

  it("開き引用符まで打っていても二重にならない", () => {
    const text = 'sum(table["秤';
    const s = computeCalcSuggestion(text, text.length, tables)!;
    const r = applyCalcSuggestion(text, text.length, s, "秤量表");
    expect(r.text).toBe('sum(table["秤量表"]["');
  });

  it("列名の確定で参照が閉じる", () => {
    const text = 'sum(table["秤量表"]["質';
    const s = computeCalcSuggestion(text, text.length, tables)!;
    const r = applyCalcSuggestion(text, text.length, s, "質量");
    expect(r.text).toBe('sum(table["秤量表"]["質量"]');
  });

  it("col( スタイルは引数区切り・閉じ括弧で繋ぐ", () => {
    let text = "col(";
    let s = computeCalcSuggestion(text, text.length, tables)!;
    let r = applyCalcSuggestion(text, text.length, s, "秤量表");
    expect(r.text).toBe('col("秤量表", "');
    text = r.text;
    s = computeCalcSuggestion(text, text.length, tables)!;
    r = applyCalcSuggestion(text, text.length, s, "質量");
    expect(r.text).toBe('col("秤量表", "質量")');
  });

  it("caret より後ろのテキストは保たれる", () => {
    const text = "x = table[\ny = 1";
    const caret = "x = table[".length;
    const s = computeCalcSuggestion(text, caret, tables)!;
    const r = applyCalcSuggestion(text, caret, s, "表 1");
    expect(r.text).toBe('x = table["表 1"]["\ny = 1');
  });
});
