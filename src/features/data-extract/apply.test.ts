import { describe, expect, it } from "vitest";
import { applyExtract } from "./apply";
import type { ExtractCondition } from "./types";

const H = ["time", "temp_c", "dough", "note"];
const R = [
  ["0", "180", "baguette", "OK fine"],
  ["1", "200.0", "country", ""],
  ["2", "220", "baguette", "steam"],
  ["3", "abc", "brioche", "ok"],
  ["4", "", "baguette", " "],
];
const run = (conditions: ExtractCondition[], columns: string[] = []) =>
  applyExtract(H, R, { columns, conditions });
const times = (conditions: ExtractCondition[], columns?: string[]) =>
  run(conditions, columns).rows.map((r) => r[0]);

describe("applyExtract", () => {
  it("条件が無く columns が空なら全列・全行（元と同じ）", () => {
    const r = run([]);
    expect(r.headers).toEqual(H);
    expect(r.rows).toEqual(R);
    expect(r.sourceRows).toBe(5);
  });

  it("選んだ列の順で返す", () => {
    const r = run([], ["dough", "time"]);
    expect(r.headers).toEqual(["dough", "time"]);
    expect(r.rows[0]).toEqual(["baguette", "0"]);
  });

  it("存在しない列名は選択から無視される（残らなければ全列）", () => {
    expect(run([], ["time", "nope"]).headers).toEqual(["time"]);
    expect(run([], ["nope"]).headers).toEqual(H);
  });

  it("gt/ge/lt/le は数値で比べる。読めない行は満たさない", () => {
    expect(times([{ column: "temp_c", op: "gt", value: "200" }])).toEqual(["2"]);
    expect(times([{ column: "temp_c", op: "ge", value: "200" }])).toEqual(["1", "2"]);
    expect(times([{ column: "temp_c", op: "lt", value: "200" }])).toEqual(["0"]);
    expect(times([{ column: "temp_c", op: "le", value: "200" }])).toEqual(["0", "1"]);
  });

  it("比べる値が数値でなければ gt 系はどの行も満たさない", () => {
    expect(times([{ column: "temp_c", op: "gt", value: "hot" }])).toEqual([]);
  });

  it("eq: 数値の列と数値の値は数値として比べる（200.0 と 200 は等しい）", () => {
    const r = applyExtract(["v"], [["1.0"], ["2"], ["1"], ["x"], [""], ["3"], ["4"], ["5"], ["6"], ["7"], ["8"]], {
      columns: [],
      conditions: [{ column: "v", op: "eq", value: "1" }],
    });
    expect(r.rows).toEqual([["1.0"], ["1"]]);
  });

  it("文字の列では 200.0 と 200 は別の文字列", () => {
    // temp_c は 4 件中 3 件しか数値でない = 文字の列
    expect(times([{ column: "temp_c", op: "eq", value: "200" }])).toEqual([]);
  });

  it("eq/ne: それ以外は前後の空白を除いた文字列で、大小を区別する", () => {
    expect(times([{ column: "dough", op: "eq", value: " baguette " }])).toEqual(["0", "2", "4"]);
    expect(times([{ column: "dough", op: "eq", value: "Baguette" }])).toEqual([]);
    expect(times([{ column: "dough", op: "ne", value: "baguette" }])).toEqual(["1", "3"]);
  });

  it("ne は数値の列で読めないセル・空セルを「等しくない」側に入れる", () => {
    const rows = [["1"], ["x"], [""], ["2"], ["3"], ["4"], ["5"], ["6"], ["7"], ["8"], ["9"], ["10"]];
    const r = applyExtract(["v"], rows, { columns: [], conditions: [{ column: "v", op: "ne", value: "1" }] });
    expect(r.rows).toHaveLength(11);
  });

  it("contains は大小を区別しない部分一致", () => {
    expect(times([{ column: "note", op: "contains", value: "ok" }])).toEqual(["0", "3"]);
  });

  it("notEmpty は空白を除いて 1 文字以上", () => {
    expect(times([{ column: "note", op: "notEmpty" }])).toEqual(["0", "2", "3"]);
  });

  it("書きかけの条件（値が空・notEmpty 以外）は無視する", () => {
    expect(times([{ column: "temp_c", op: "gt", value: "" }])).toEqual(["0", "1", "2", "3", "4"]);
    expect(times([{ column: "temp_c", op: "gt" }])).toEqual(["0", "1", "2", "3", "4"]);
    expect(times([{ column: "temp_c", op: "eq", value: "  " }])).toHaveLength(5);
  });

  it("存在しない列を指す条件は無視する", () => {
    expect(times([{ column: "nope", op: "eq", value: "x" }])).toHaveLength(5);
  });

  it("複数の条件は AND", () => {
    expect(
      times([
        { column: "dough", op: "eq", value: "baguette" },
        { column: "temp_c", op: "ge", value: "200" },
      ])
    ).toEqual(["2"]);
  });

  it("行の順序が保たれる", () => {
    expect(times([{ column: "dough", op: "ne", value: "country" }])).toEqual(["0", "2", "3", "4"]);
  });

  it("条件の列が出力の列に入っていなくても絞れる", () => {
    const r = run([{ column: "dough", op: "eq", value: "country" }], ["time"]);
    expect(r.headers).toEqual(["time"]);
    expect(r.rows).toEqual([["1"]]);
  });

  it("0 行になるときも headers と sourceRows は返す", () => {
    const r = run([{ column: "dough", op: "eq", value: "none" }], ["time"]);
    expect(r.rows).toEqual([]);
    expect(r.headers).toEqual(["time"]);
    expect(r.sourceRows).toBe(5);
  });

  it("同名の列は最初の 1 つを指す", () => {
    const r = applyExtract(["a", "a"], [["1", "9"], ["2", "9"]], {
      columns: [],
      conditions: [{ column: "a", op: "eq", value: "2" }],
    });
    expect(r.rows).toEqual([["2", "9"]]);
  });
});
