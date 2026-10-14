import { describe, it, expect } from "vitest";
import {
  normalizeForQuoteMatch,
  quoteAppearsIn,
  quoteAppearsInAny,
  containsWithin,
} from "./quote-check.ts";

describe("quoteAppearsIn", () => {
  const src = "ボールミル粉砕で κ_lat は下がったが、Cu 空孔経由で S も下がった。";
  it("完全一致", () => {
    expect(quoteAppearsIn("Cu 空孔経由で S も下がった", src)).toBe(true);
  });
  it("全角半角の差を吸収する", () => {
    expect(quoteAppearsIn("ＣＵ空孔経由でＳも下がった", src)).toBe(true);
  });
  it("改行・空白の差を吸収する", () => {
    expect(quoteAppearsIn("Cu 空孔\n経由で\tS も 下がった", src)).toBe(true);
  });
  it("句読点の差を吸収する", () => {
    expect(quoteAppearsIn("下がったが,Cu空孔経由", src)).toBe(true);
  });
  it("不一致（捏造）は false", () => {
    expect(quoteAppearsIn("格子欠陥の増加が原因である", src)).toBe(false);
  });
  it("6 文字未満は false", () => {
    expect(quoteAppearsIn("下がった", src)).toBe(false);
    expect(quoteAppearsIn("12345", "12345 and more")).toBe(false);
    expect(quoteAppearsIn("123456", "123456 and more")).toBe(true);
  });
  it("minLength を変えられる", () => {
    expect(quoteAppearsIn("下がった", src, 2)).toBe(true);
  });
});

describe("単位記号の正規化", () => {
  it("㎏ は NFKC で kg になる", () => {
    expect(normalizeForQuoteMatch("㎏")).toBe("kg");
    expect(quoteAppearsIn("質量は 5 kg だった", "質量は 5 ㎏ だった")).toBe(true);
  });
  it("κ は変わらない", () => {
    expect(normalizeForQuoteMatch("κ")).toBe("κ");
  });
});

describe("quoteAppearsInAny", () => {
  it("いずれかの出典に出れば true", () => {
    expect(quoteAppearsInAny("second source text", ["first", "the second source text here"])).toBe(true);
  });
  it("出典 2 本の継ぎ目をまたぐ引用は false", () => {
    expect(quoteAppearsInAny("alphabeta-gamma", ["xx alphabeta", "-gamma yy"])).toBe(false);
  });
  it("出典が空配列なら false", () => {
    expect(quoteAppearsInAny("anything long", [])).toBe(false);
  });
});

describe("containsWithin", () => {
  it("数値は文字列化して照合する", () => {
    expect(containsWithin(300, "焼結温度は 300 K")).toBe(true);
    expect(containsWithin(0.5, "比率 0.5 で")).toBe(true);
    expect(containsWithin(400, "焼結温度は 300 K")).toBe(false);
  });
  it("短い語でも照合できる", () => {
    expect(containsWithin("S", "S も下がる")).toBe(true);
  });
  it("空文字は false", () => {
    expect(containsWithin("", "abc")).toBe(false);
  });
});
