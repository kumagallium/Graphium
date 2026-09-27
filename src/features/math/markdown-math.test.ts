import { describe, it, expect } from "vitest";
import { stashMath, restoreMath, mathBlockToMarkdown, inlineMathToMarkdown } from "./markdown-math";

/** テスト用: paragraph ブロックを組み立てる */
function para(text: string) {
  return { id: "b1", type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children: [] };
}

describe("stashMath", () => {
  it("\\[ ... \\] をブロック数式として退避する", () => {
    const { text, math } = stashMath("前文\n\n\\[\n\\log P = \\log A - b T \\tag{2}\n\\]\n\n後文");
    expect(math).toEqual([{ latex: "\\log P = \\log A - b T \\tag{2}", display: true }]);
    expect(text).toContain("{{GWMATH_0}}");
    expect(text).not.toContain("\\log P");
  });

  it("$$ ... $$ をブロック数式として退避する", () => {
    const { math } = stashMath("$$\nE = mc^2\n$$");
    expect(math).toEqual([{ latex: "E = mc^2", display: true }]);
  });

  it("\\( ... \\) をインライン数式として退避する", () => {
    const { text, math } = stashMath("対数尺度上では \\(\\log A = 3.862\\) である。");
    expect(math).toEqual([{ latex: "\\log A = 3.862", display: false }]);
    expect(text).toBe("対数尺度上では {{GWMATH_0}} である。");
  });

  it("$ ... $ をインライン数式として退避する", () => {
    const { math } = stashMath("係数は $b = -0.126$ となる。");
    expect(math).toEqual([{ latex: "b = -0.126", display: false }]);
  });

  it("金額表記は数式として拾わない", () => {
    const { text, math } = stashMath("価格は $100 から $200 に上がった。");
    expect(math).toEqual([]);
    expect(text).toBe("価格は $100 から $200 に上がった。");
  });

  it("価格帯（$ の間がダッシュやスラッシュだけ）も数式として拾わない", () => {
    for (const src of ["1 kg あたり $50-$75 で買える", "$50–$75", "($5/$10)", "US$50-$75"]) {
      const { text, math } = stashMath(src);
      expect(math).toEqual([]);
      expect(text).toBe(src);
    }
  });

  it("閉じの $ の直後が数字でなければ、式の直後に文字が続いても数式にする", () => {
    const { math } = stashMath("$x$-軸と $y$、$n$個");
    expect(math.map((m) => m.latex)).toEqual(["x", "y", "n"]);
  });

  it("フェンスコードブロック内の $$ は数式にしない", () => {
    const src = "```latex\n$$\nE = mc^2\n$$\n```";
    const { text, math } = stashMath(src);
    expect(math).toEqual([]);
    expect(text).toBe(src);
  });

  it("インラインコード内の $x$ は数式にしない", () => {
    const src = "`$x$` と書くとインライン数式になる";
    const { text, math } = stashMath(src);
    expect(math).toEqual([]);
    expect(text).toBe(src);
  });

  it("ブロック数式は前後に空行を入れて独立段落にする", () => {
    const { text } = stashMath("文中に \\[x = 1\\] がある");
    expect(text).toBe("文中に \n\n{{GWMATH_0}}\n\n がある");
  });

  it("ブロックとインラインが混在しても順番どおり退避する", () => {
    const { math } = stashMath("$$a$$ と \\(b\\) と $c$");
    expect(math).toEqual([
      { latex: "a", display: true },
      { latex: "b", display: false },
      { latex: "c", display: false },
    ]);
  });

  it("長すぎるインライン候補は数式にしない", () => {
    const long = "x".repeat(300);
    const { math } = stashMath(`$${long}$`);
    expect(math).toEqual([]);
  });

  it("数式が無ければ入力をそのまま返す", () => {
    const src = "ふつうの段落です。";
    const { text, math } = stashMath(src);
    expect(text).toBe(src);
    expect(math).toEqual([]);
  });
});

// <sup> / <sub> の中の \ は書き出し側（lib/script-styles.ts の escapeForScriptTag）が付けた
// エスケープで、数式の区切りではない
describe("stashMath - 上付き・下付きの中のエスケープ", () => {
  it("上付きの「[1]」の書き出し（<sup>\\[1\\]</sup>）を数式にしない（タグの対を割らない）", () => {
    const src = "文献<sup>\\[1\\]</sup>。";
    expect(stashMath(src)).toEqual({ text: src, math: [] });
  });

  it("エスケープされた \\ の直後の ( や [ も数式の区切りにしない", () => {
    // 上付きの「\(a\)」は <sup>\\(a\\)</sup>、下付きの「\[b\]」は <sub>\\\[b\\\]</sub> と書かれる
    for (const src of ["x<sup>\\\\(a\\\\)</sup>", "y<sub>\\\\\\[b\\\\\\]</sub>"]) {
      expect(stashMath(src)).toEqual({ text: src, math: [] });
    }
  });

  it("タグの外の数式は従来どおり拾う", () => {
    const { text, math } = stashMath("\\(y\\) と $z$ と \\[w\\] と <sup>\\[1\\]</sup>");
    expect(math).toEqual([
      { latex: "w", display: true },
      { latex: "y", display: false },
      { latex: "z", display: false },
    ]);
    expect(text).toBe("{{GWMATH_1}} と {{GWMATH_2}} と \n\n{{GWMATH_0}}\n\n と <sup>\\[1\\]</sup>");
  });

  it("タグの外で開いた \\[ をタグの中の \\] で閉じない", () => {
    const src = "\\[a <sup>\\]</sup> b";
    expect(stashMath(src)).toEqual({ text: src, math: [] });
  });

  it("タグの中の $…$ は従来どおり数式にする", () => {
    expect(stashMath("a<sup>$x^2$</sup>")).toEqual({
      text: "a<sup>{{GWMATH_0}}</sup>",
      math: [{ latex: "x^2", display: false }],
    });
  });

  it("タグをまたぐ数式の中身には、区切りを守るために挟んだ目印を残さない", () => {
    expect(stashMath("$a <sup>\\[1\\]</sup> b$").math).toEqual([
      { latex: "a <sup>\\[1\\]</sup> b", display: false },
    ]);
  });
});

describe("restoreMath", () => {
  it("センチネルだけの段落を math ブロックにする", () => {
    const blocks = [para("{{GWMATH_0}}")];
    const out = restoreMath(blocks, [{ latex: "E = mc^2", display: true }]);
    expect(out[0]).toMatchObject({ type: "math", props: { latex: "E = mc^2" } });
    expect(out[0].content).toBeUndefined();
  });

  it("文中のセンチネルを inlineMath に展開する", () => {
    const blocks = [para("係数は {{GWMATH_0}} である")];
    const out = restoreMath(blocks, [{ latex: "b = -0.126", display: false }]);
    expect(out[0].type).toBe("paragraph");
    expect(out[0].content).toEqual([
      { type: "text", text: "係数は ", styles: {} },
      { type: "inlineMath", props: { latex: "b = -0.126" } },
      { type: "text", text: " である", styles: {} },
    ]);
  });

  it("インライン数式は単独段落でもブロックに昇格させない", () => {
    const blocks = [para("{{GWMATH_0}}")];
    const out = restoreMath(blocks, [{ latex: "x", display: false }]);
    expect(out[0].type).toBe("paragraph");
    expect(out[0].content[0]).toEqual({ type: "inlineMath", props: { latex: "x" } });
  });

  it("見出しの中の数式はインラインとして展開する（構造を保つ）", () => {
    const blocks = [{ id: "h", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "{{GWMATH_0}}", styles: {} }], children: [] }];
    const out = restoreMath(blocks, [{ latex: "E", display: true }]);
    expect(out[0].type).toBe("heading");
    expect(out[0].content[0]).toEqual({ type: "inlineMath", props: { latex: "E" } });
  });

  it("子ブロックの数式も再帰的に復元する", () => {
    const blocks = [{ id: "p", type: "bulletListItem", props: {}, content: [{ type: "text", text: "親", styles: {} }], children: [para("{{GWMATH_0}}")] }];
    const out = restoreMath(blocks, [{ latex: "y = ax", display: true }]);
    expect(out[0].children[0]).toMatchObject({ type: "math", props: { latex: "y = ax" } });
  });

  it("リンクの中の数式も展開する", () => {
    const blocks = [{
      id: "b", type: "paragraph", props: {}, children: [],
      content: [{ type: "link", href: "https://example.com", content: [{ type: "text", text: "{{GWMATH_0}}", styles: {} }] }],
    }];
    const out = restoreMath(blocks, [{ latex: "z", display: false }]);
    expect(out[0].content[0].content[0]).toEqual({ type: "inlineMath", props: { latex: "z" } });
  });

  it("stash が空なら入力をそのまま返す", () => {
    const blocks = [para("ふつうの段落")];
    expect(restoreMath(blocks, [])).toBe(blocks);
  });

  it("テキストのスタイルは保持したまま前後に分割する", () => {
    const blocks = [{
      id: "b", type: "paragraph", props: {}, children: [],
      content: [{ type: "text", text: "太字 {{GWMATH_0}} 継続", styles: { bold: true } }],
    }];
    const out = restoreMath(blocks, [{ latex: "n", display: false }]);
    expect(out[0].content[0]).toEqual({ type: "text", text: "太字 ", styles: { bold: true } });
    expect(out[0].content[2]).toEqual({ type: "text", text: " 継続", styles: { bold: true } });
  });
});

describe("Markdown 書き出し", () => {
  it("math ブロックは $$ で囲む", () => {
    expect(mathBlockToMarkdown("E = mc^2")).toBe("$$ E = mc^2 $$");
  });

  it("複数行の LaTeX は 1 行に潰す（hard break で壊れるのを防ぐ）", () => {
    expect(mathBlockToMarkdown("a = b\n  + c")).toBe("$$ a = b + c $$");
  });

  it("inlineMath は $ で囲む", () => {
    expect(inlineMathToMarkdown("x^2")).toBe("$x^2$");
  });

  it("空の LaTeX は空文字にする", () => {
    expect(mathBlockToMarkdown("  ")).toBe("");
    expect(inlineMathToMarkdown("")).toBe("");
  });
});

describe("往復（実データの壊れ方の再現）", () => {
  it("論文翻訳で崩れていた \\[ ... \\] が math ブロックに戻る", () => {
    // 実ノート「環境の記憶への反映」で paragraph "[\n\\log P = ...\n]" に崩れていたもの
    const src = "このことは線形関係が得られる。\n\n\\[\n\\text{Log }P = \\log A - b \\log T \\quad (4)\n\\]\n\n図 2b は…";
    const { text, math } = stashMath(src);
    expect(math[0].display).toBe(true);

    // BlockNote のパース結果を模した最小構造で復元を確認する
    const parsed = text
      .split(/\n{2,}/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(para);
    const out = restoreMath(parsed, math);

    expect(out.map((b: any) => b.type)).toEqual(["paragraph", "math", "paragraph"]);
    expect(out[1].props.latex).toBe("\\text{Log }P = \\log A - b \\log T \\quad (4)");
  });
});
