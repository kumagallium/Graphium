// 拡大表示の並べ替えロジック
import { describe, expect, it } from "vitest";
import { isNumericColumn, sortRows } from "./expand-modal";

describe("isNumericColumn", () => {
  it("非空セルの過半が数値なら数値列", () => {
    expect(
      isNumericColumn(
        [["1.2"], ["3,400"], ["36.5℃"], ["メモ"]],
        0
      )
    ).toBe(true);
  });

  it("文字列が過半なら文字列列", () => {
    expect(isNumericColumn([["A-1"], ["A-2"], ["3"]], 0)).toBe(false);
  });

  it("空セルは母数に入れない（全部空なら文字列扱い）", () => {
    expect(isNumericColumn([[""], [""]], 0)).toBe(false);
    expect(isNumericColumn([[""], ["1"], [""]], 0)).toBe(true);
  });
});

describe("sortRows", () => {
  const rows = [
    ["A-3", "10.5 g"],
    ["A-1", "2 g"],
    ["A-2", ""],
    ["A-10", "0.33 g"],
  ];

  it("null なら元の並びのまま（同じ参照を返さない）", () => {
    expect(sortRows(rows, null)).toBe(rows);
  });

  it("数値列は単位付きでも数値として昇順に並ぶ。空セルは末尾", () => {
    const sorted = sortRows(rows, { col: 1, dir: "asc" });
    expect(sorted.map((r) => r[1])).toEqual(["0.33 g", "2 g", "10.5 g", ""]);
  });

  it("降順でも空セルは末尾", () => {
    const sorted = sortRows(rows, { col: 1, dir: "desc" });
    expect(sorted.map((r) => r[1])).toEqual(["10.5 g", "2 g", "0.33 g", ""]);
  });

  it("文字列列は数値混じりを自然順で比べる（A-2 < A-10）", () => {
    const sorted = sortRows(rows, { col: 0, dir: "asc" });
    expect(sorted.map((r) => r[0])).toEqual(["A-1", "A-2", "A-3", "A-10"]);
  });

  it("元の配列は変更しない", () => {
    const before = rows.map((r) => [...r]);
    sortRows(rows, { col: 1, dir: "asc" });
    expect(rows).toEqual(before);
  });

  it("同値は元の並びを保つ（安定）", () => {
    const same = [
      ["x", "1"],
      ["y", "1"],
      ["z", "1"],
    ];
    const sorted = sortRows(same, { col: 1, dir: "desc" });
    expect(sorted.map((r) => r[0])).toEqual(["x", "y", "z"]);
  });
});
