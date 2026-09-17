import { describe, expect, it } from "vitest";
import { findBlockIdForQuote } from "./quote-match";

const blocks = [
  { id: "b1", text: "融点は 800℃ である。" },
  { id: "b2", text: "この物質は水に溶けやすい。" },
];

describe("findBlockIdForQuote", () => {
  it("quote を含む唯一のブロックの id を返す", () => {
    expect(findBlockIdForQuote(blocks, "水に溶けやすい")).toBe("b2");
  });

  it("空白ゆれ（全角空白 vs 半角空白）でも一致する", () => {
    const withSpace = [{ id: "b1", text: "融点は　800℃　である。" }]; // 全角空白
    expect(findBlockIdForQuote(withSpace, "融点は 800℃ である")).toBe("b1");
  });

  it("どのブロックにも見つからなければ undefined", () => {
    expect(findBlockIdForQuote(blocks, "存在しない引用")).toBeUndefined();
  });

  it("quote / blocks が無ければ undefined", () => {
    expect(findBlockIdForQuote(undefined, "x")).toBeUndefined();
    expect(findBlockIdForQuote(blocks, undefined)).toBeUndefined();
    expect(findBlockIdForQuote(blocks, "")).toBeUndefined();
  });

  it("複数ブロックに一致する quote は一意に決まらないため undefined", () => {
    const dup = [
      { id: "b1", text: "共通の一文。" },
      { id: "b2", text: "共通の一文。" },
    ];
    expect(findBlockIdForQuote(dup, "共通の一文")).toBeUndefined();
  });
});
