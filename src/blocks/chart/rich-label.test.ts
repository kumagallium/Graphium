import { describe, it, expect } from "vitest";
import {
  hasRichMarkup,
  isRich,
  parseRichSegments,
  plainOf,
  richTextOption,
  stripRichMarkup,
  textOf,
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

  it("\\it{} が斜体になる", () => {
    expect(parseRichSegments("\\it{T} / K")).toEqual([
      { text: "T", style: "it" },
      { text: " / K", style: "plain" },
    ]);
  });

  it("斜体の中の上下付きは合成スタイルになる", () => {
    expect(parseRichSegments("\\it{C_{p}}")).toEqual([
      { text: "C", style: "it" },
      { text: "p", style: "isub" },
    ]);
  });

  it("上下付きの中でも斜体にできる", () => {
    expect(parseRichSegments("x^{\\it{n}}")).toEqual([
      { text: "x", style: "plain" },
      { text: "n", style: "isup" },
    ]);
  });

  it("同じスタイルが続いたらまとめる", () => {
    expect(parseRichSegments("\\it{ab}\\it{cd}")).toEqual([{ text: "abcd", style: "it" }]);
  });
});

describe("ギリシャ文字・記号のコマンド", () => {
  it("既知のコマンドは文字になる", () => {
    expect(stripRichMarkup("2\\theta")).toBe("2θ");
    expect(stripRichMarkup("\\lambda / \\AA")).toBe("λ / Å");
    expect(stripRichMarkup("\\Delta\\it{H}")).toBe("ΔH");
    expect(stripRichMarkup("25 \\pm 3 \\deg")).toBe("25 ± 3 °");
  });

  it("知らないコマンドは書かれたまま残す（黙って消さない）", () => {
    expect(stripRichMarkup("\\unknowncmd x")).toBe("\\unknowncmd x");
    expect(hasRichMarkup("\\unknowncmd x")).toBe(false);
  });

  it("記号だけなら rich を付けず、文字に置き換えた素のテキストにする", () => {
    expect(richTextOption("2\\theta (deg)", 16)).toEqual({ text: "2θ (deg)" });
  });
});

describe("中括弧は LaTeX と同じく省略できる", () => {
  it("1 文字なら中括弧が要らない", () => {
    expect(toEchartsRichText("H_2O")).toBe("H{sub|2}O");
    expect(toEchartsRichText("cm^3")).toBe("cm{sup|3}");
    // 中括弧つきと同じ結果になる
    expect(toEchartsRichText("H_2O")).toBe(toEchartsRichText("H_{2}O"));
  });

  it("引数はコマンド 1 つでもよい", () => {
    expect(toEchartsRichText("x_\\alpha")).toBe("x{sub|α}");
  });

  it("2 文字以上は中括弧が要る（LaTeX と同じ）", () => {
    expect(toEchartsRichText("x_12")).toBe("x{sub|1}2");
    expect(toEchartsRichText("x_{12}")).toBe("x{sub|12}");
  });

  it("引数が無い末尾の記号は字として出す", () => {
    expect(hasRichMarkup("100^")).toBe(false);
    expect(stripRichMarkup("100^")).toBe("100^");
  });

  it("閉じ括弧が無いときは残りを中身として読む（打っている途中に追従する）", () => {
    expect(toEchartsRichText("H_{2")).toBe("H{sub|2}");
    expect(toEchartsRichText("\\it{T")).toBe("{it|T}");
  });
});

describe("記法を読むのは人が書いた文字列だけ", () => {
  // 凡例と軸名はユーザーが名前を付けていなければ列名がそのまま出る。列名は
  // 生データの識別子なので、記法として読むと過去のノートの図が黙って変わる
  it.each(["temp_c", "x_1", "H_2O", "a^b", "2^10", "rate_per_s"])(
    "列名 %s は素通しになる",
    (name) => {
      const label = { text: name, authored: false };
      expect(isRich(label)).toBe(false);
      expect(textOf(label)).toBe(name);
      expect(plainOf(label)).toBe(name);
    },
  );

  it("同じ文字列でも、人が入力欄に書いたものは記法として読む", () => {
    const label = { text: "H_2O", authored: true };
    expect(isRich(label)).toBe(true);
    expect(textOf(label)).toBe("H{sub|2}O");
    expect(plainOf(label)).toBe("H2O");
  });

  it("記法を含まない入力は、書いたままの文字になる", () => {
    const label = { text: "Intensity (a.u.)", authored: true };
    expect(isRich(label)).toBe(false);
    expect(textOf(label)).toBe("Intensity (a.u.)");
  });

  it("スタイルを伴わない記号だけの入力も文字に置き換える", () => {
    const label = { text: "2\\theta", authored: true };
    expect(isRich(label)).toBe(false);
    expect(textOf(label)).toBe("2θ");
  });
});

describe("エスケープ", () => {
  it("記号そのものを書ける", () => {
    expect(stripRichMarkup("a\\_b")).toBe("a_b");
    expect(hasRichMarkup("a\\_b")).toBe(false);
    expect(stripRichMarkup("50 \\% \\{x\\}")).toBe("50 % {x}");
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
    expect(stripRichMarkup("\\it{C}_{p} (J g^{-1} K^{-1})")).toBe("Cp (J g-1 K-1)");
  });
});

describe("toEchartsRichText", () => {
  it("rich タグに変換する", () => {
    expect(toEchartsRichText("H_{2}O")).toBe("H{sub|2}O");
    // 斜体を閉じたあとの添字は立体（物理量 T は斜体、添字 c は立体、が正しい組版）
    expect(toEchartsRichText("\\it{T}_{c}")).toBe("{it|T}{sub|c}");
    expect(toEchartsRichText("\\it{T_{c}}")).toBe("{it|T}{isub|c}");
  });

  it("平文に残った中括弧は落とす（ECharts のタグ記法と衝突するため）", () => {
    expect(toEchartsRichText("a\\{b\\}c_{1}")).toBe("abc{sub|1}");
  });
});

describe("richTextOption", () => {
  it("記法が無ければ rich を付けない", () => {
    expect(richTextOption("Intensity (a.u.)", 16)).toEqual({ text: "Intensity (a.u.)" });
    expect(richTextOption("Temperature (K)", 16)).toEqual({ text: "Temperature (K)" });
  });

  it("記法があれば rich 定義を添える", () => {
    const out = richTextOption("2\\it{\\theta} (^{o})", 16);
    expect(out.text).toBe("2{it|θ} ({sup|o})");
    expect(out.rich?.sup).toMatchObject({ verticalAlign: "top" });
    expect(out.rich?.isub).toMatchObject({ verticalAlign: "bottom", fontStyle: "italic" });
  });

  it("基準サイズに応じて上下付きの字を小さくする", () => {
    expect(richTextOption("x^{2}", 16).rich?.sup?.fontSize).toBe(11);
    expect(richTextOption("x^{2}", 12).rich?.sup?.fontSize).toBe(8);
  });
});
