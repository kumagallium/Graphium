import { describe, it, expect } from "vitest";
import {
  hasRichMarkup,
  parseRichSegments,
  richTextOption,
  stripRichMarkup,
  toEchartsRichText,
} from "./rich-label";

describe("parseRichSegments", () => {
  it("記法が無ければ 1 つの平文になる", () => {
    expect(parseRichSegments("Temperature (K)")).toEqual([
      { text: "Temperature (K)", style: "plain" },
    ]);
  });

  it("下付き・上付きを切り出す", () => {
    expect(parseRichSegments("H_{2}O")).toEqual([
      { text: "H", style: "plain" },
      { text: "2", style: "sub" },
      { text: "O", style: "plain" },
    ]);
    expect(parseRichSegments("cm^{3}")).toEqual([
      { text: "cm", style: "plain" },
      { text: "3", style: "sup" },
    ]);
  });

  it("斜体の中の上下付きは合成スタイルになる", () => {
    expect(parseRichSegments("*C_{p}*")).toEqual([
      { text: "C", style: "it" },
      { text: "p", style: "isub" },
    ]);
  });

  it("斜体と平文が混ざる", () => {
    expect(parseRichSegments("*T* / K")).toEqual([
      { text: "T", style: "it" },
      { text: " / K", style: "plain" },
    ]);
  });
});

describe("既存の列名を巻き込まない", () => {
  // 凡例はユーザーが名前を付けていなければ列名がそのまま出るため、
  // 中括弧の無い `_` `^` を記法として解釈すると過去のノートの図が変わる
  it.each(["temp_c", "x_1", "a^b", "2^10", "rate_per_s"])("%s は素のまま", (name) => {
    expect(hasRichMarkup(name)).toBe(false);
    expect(stripRichMarkup(name)).toBe(name);
    expect(richTextOption(name, 16)).toEqual({ text: name });
  });

  it("閉じていない中括弧も記法にしない", () => {
    expect(hasRichMarkup("H_{2")).toBe(false);
    expect(stripRichMarkup("H_{2")).toBe("H_{2");
  });
});

describe("エスケープ", () => {
  it("記号そのものを書ける", () => {
    expect(stripRichMarkup("2 \\* 3")).toBe("2 * 3");
    expect(hasRichMarkup("2 \\* 3")).toBe(false);
    expect(stripRichMarkup("a\\_{b}")).toBe("a_{b}");
  });

  it("中括弧の中でも閉じ括弧を書ける", () => {
    expect(parseRichSegments("f^{\\}}")).toEqual([
      { text: "f", style: "plain" },
      { text: "}", style: "sup" },
    ]);
  });
});

describe("stripRichMarkup", () => {
  it("ツールチップ・書き出し用に記法を落とす", () => {
    expect(stripRichMarkup("H_{2}O")).toBe("H2O");
    expect(stripRichMarkup("*C*_{p} (J g^{-1} K^{-1})")).toBe("Cp (J g-1 K-1)");
  });
});

describe("toEchartsRichText", () => {
  it("rich タグに変換する", () => {
    expect(toEchartsRichText("H_{2}O")).toBe("H{sub|2}O");
    // 斜体を閉じたあとの添字は立体（物理量 T は斜体、添字 c は立体、が正しい組版）
    expect(toEchartsRichText("*T*_{c}")).toBe("{it|T}{sub|c}");
    expect(toEchartsRichText("*T_{c}*")).toBe("{it|T}{isub|c}");
  });

  it("平文に残った中括弧は落とす（ECharts のタグ記法と衝突するため）", () => {
    expect(toEchartsRichText("a{b}c_{1}")).toBe("abc{sub|1}");
  });
});

describe("richTextOption", () => {
  it("記法が無ければ rich を付けない", () => {
    expect(richTextOption("Intensity (a.u.)", 16)).toEqual({ text: "Intensity (a.u.)" });
  });

  it("記法があれば rich 定義を添える", () => {
    const out = richTextOption("2*θ* (^{o})", 16);
    expect(out.text).toBe("2{it|θ} ({sup|o})");
    expect(out.rich?.sup).toMatchObject({ verticalAlign: "top" });
    expect(out.rich?.isub).toMatchObject({ verticalAlign: "bottom", fontStyle: "italic" });
  });

  it("基準サイズに応じて上下付きの字を小さくする", () => {
    expect(richTextOption("x^{2}", 16).rich?.sup?.fontSize).toBe(11);
    expect(richTextOption("x^{2}", 12).rich?.sup?.fontSize).toBe(8);
  });
});
