import { describe, expect, it } from "vitest";
import { tableColumnsEqual, tableRowNamesEqual } from "./columns-equal";
import type { TableColumnData, TableColumnsIndex } from "./types";

const col = (...values: (number | null)[]): TableColumnData => ({ values });

describe("tableColumnsEqual", () => {
  it("中身が同じなら true（参照が違っても）", () => {
    const a: TableColumnsIndex = { 表: { x: col(1, 2), y: { values: [1], unit: "g" } } };
    const b: TableColumnsIndex = { 表: { x: col(1, 2), y: { values: [1], unit: "g" } } };
    expect(tableColumnsEqual(a, b)).toBe(true);
  });

  it("同じ列データの参照は JSON 化せずに一致とみなす", () => {
    const big = col(1, 2, 3);
    // values を読まれたら気づけるよう、JSON 化されると落とす
    Object.defineProperty(big, "toJSON", {
      value: () => {
        throw new Error("参照が同じ列は JSON 化しない");
      },
      enumerable: false,
    });
    expect(tableColumnsEqual({ 表: { x: big } }, { 表: { x: big } })).toBe(true);
  });

  it("値が違えば false", () => {
    expect(tableColumnsEqual({ 表: { x: col(1, 2) } }, { 表: { x: col(1, 3) } })).toBe(false);
    expect(
      tableColumnsEqual({ 表: { x: { values: [1], unit: "g" } } }, { 表: { x: { values: [1], unit: "kg" } } })
    ).toBe(false);
  });

  it("表の名前の集合・並びが違えば false", () => {
    expect(tableColumnsEqual({ a: {}, b: {} }, { a: {} })).toBe(false);
    expect(tableColumnsEqual({ a: {}, b: {} }, { b: {}, a: {} })).toBe(false);
    expect(tableColumnsEqual({ a: {} }, { b: {} })).toBe(false);
  });

  it("列名の集合・並びが違えば false", () => {
    expect(tableColumnsEqual({ 表: { x: col(1) } }, { 表: { x: col(1), y: col(1) } })).toBe(false);
    expect(tableColumnsEqual({ 表: { x: col(1), y: col(2) } }, { 表: { y: col(2), x: col(1) } })).toBe(false);
  });

  it("空どうしは true", () => {
    expect(tableColumnsEqual({}, {})).toBe(true);
  });
});

describe("tableRowNamesEqual", () => {
  it("中身が同じなら true（参照が違っても）", () => {
    expect(tableRowNamesEqual({ 表: ["a", "b"] }, { 表: ["a", "b"] })).toBe(true);
  });

  it("同じ参照の並びは中身を見ずに等しい", () => {
    const rows = ["a", "b"];
    expect(tableRowNamesEqual({ 表: rows }, { 表: rows })).toBe(true);
  });

  it("並び・長さ・表の名前が違えば false", () => {
    expect(tableRowNamesEqual({ 表: ["a", "b"] }, { 表: ["b", "a"] })).toBe(false);
    expect(tableRowNamesEqual({ 表: ["a"] }, { 表: ["a", "b"] })).toBe(false);
    expect(tableRowNamesEqual({ 表: ["a"] }, { 別の表: ["a"] })).toBe(false);
    expect(tableRowNamesEqual({ 表: ["a"] }, { 表: ["a"], 表2: [] })).toBe(false);
  });
});
