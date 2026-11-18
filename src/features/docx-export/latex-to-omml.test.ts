// latex-to-omml.ts / mathml-to-omml.ts（LaTeX → Word の数式）のユニットテスト
//
// 式ごとに「全部写せたら数式、写せなければ null」を確かめる。
// XML の形は、Word の定義（shared-math.xsd）での要素の並びに合わせてある。

import { describe, it, expect } from "vitest";
import { latexToOmml, MAX_MATH_LATEX_LENGTH } from "./latex-to-omml";
import { mathMLToOmml, MathUnsupportedError, ommlToXml, parseMathML } from "./mathml-to-omml";

/** 数式になった式の XML（書体の指定と preserve は読みやすさのため落とす） */
function xml(latex: string, display = false): string {
  const omml = latexToOmml(latex, display);
  if (!omml) throw new Error(`not converted: ${latex}`);
  return ommlToXml(omml)
    .replace(/<w:rPr><w:rFonts[^>]*\/><\/w:rPr>/g, "")
    .replace(/ xml:space="preserve"/g, "");
}

describe("Word の数式になる式", () => {
  it("分数", () => {
    expect(xml("\\frac{a}{b}")).toBe(
      "<m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>",
    );
    // \dfrac・\tfrac は大きさの指定だけなので、同じ分数になる
    expect(xml("\\dfrac{1}{2}")).toContain("<m:f><m:num>");
    expect(xml("\\tfrac{1}{2}")).toContain("<m:f><m:num>");
  });

  it("上付き・下付き", () => {
    expect(xml("x^2")).toContain("<m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup>");
    expect(xml("a_i")).toContain("<m:sSub><m:e><m:r><m:t>a</m:t></m:r></m:e><m:sub><m:r><m:t>i</m:t></m:r></m:sub></m:sSub>");
    expect(xml("y_i^{2}")).toContain("<m:sSubSup><m:e>");
    // 入れ子
    expect(xml("e^{-x^2}")).toMatch(/<m:sSup><m:e>.*<m:sup>.*<m:sSup>/);
  });

  it("根号", () => {
    expect(xml("\\sqrt{x}")).toContain('<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad>');
    expect(xml("\\sqrt[3]{y}")).toContain("<m:rad><m:deg><m:r><m:t>3</m:t></m:r></m:deg><m:e><m:r><m:t>y</m:t></m:r></m:e></m:rad>");
  });

  it("ギリシャ文字: 小文字は既定（斜体）、大文字は立体", () => {
    const out = xml("\\alpha + \\Gamma");
    expect(out).toContain("<m:r><m:t>α+</m:t></m:r>");
    expect(out).toContain('<m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t>Γ</m:t></m:r>');
    expect(xml("\\pi \\theta \\sigma \\Omega")).toMatch(/πθσ.*Ω/);
  });

  it("総和: ブロックでは添え字が上下、文中では横。後ろに続く項が中身になる", () => {
    const block = xml("\\sum_{i=1}^{n} x_i = S", true);
    expect(block).toContain('<m:nary><m:naryPr><m:chr m:val="∑"/><m:limLoc m:val="undOvr"/></m:naryPr>');
    expect(block).toContain("<m:sub><m:r><m:t>i=1</m:t></m:r></m:sub><m:sup><m:r><m:t>n</m:t></m:r></m:sup><m:e><m:sSub>");
    // 等号から後ろは総和の外
    expect(block).toMatch(/<\/m:nary><m:r><m:t>=S<\/m:t><\/m:r><\/m:oMath>$/);
    expect(xml("\\sum_{i=1}^{n} x_i", false)).toContain('<m:limLoc m:val="subSup"/>');
    expect(xml("\\prod_{k=1}^{n} k", true)).toContain('<m:chr m:val="∏"/>');
  });

  it("積分", () => {
    const out = xml("\\int_0^1 f(x)\\,dx = 1", true);
    expect(out).toContain('<m:nary><m:naryPr><m:chr m:val="∫"/><m:limLoc m:val="subSup"/></m:naryPr><m:sub><m:r><m:t>0</m:t></m:r></m:sub><m:sup><m:r><m:t>1</m:t></m:r></m:sup><m:e>');
    expect(out).toMatch(/<\/m:nary><m:r><m:t>=1<\/m:t><\/m:r>/);
    // 添え字の無い積分は、添え字を隠した形
    expect(xml("\\int f")).toContain('<m:subHide m:val="1"/><m:supHide m:val="1"/></m:naryPr><m:sub/><m:sup/><m:e>');
    expect(xml("\\oint_C f")).toContain('<m:chr m:val="∮"/>');
  });

  it("中身の無い総和は、空の引数を作らない", () => {
    const out = xml("\\sum_{i} = 3", true);
    expect(out).not.toContain("<m:nary>");
    expect(out).not.toContain("<m:e/>");
    expect(out).toContain("∑");
  });

  it("括弧: \\left \\right は伸びる括弧、ふつうの括弧は文字のまま", () => {
    expect(xml("\\left( \\frac{a}{b} \\right)")).toContain('<m:d><m:dPr><m:begChr m:val="("/><m:endChr m:val=")"/></m:dPr><m:e><m:f>');
    expect(xml("\\left[ a \\right]")).toContain('<m:begChr m:val="["/><m:endChr m:val="]"/>');
    expect(xml("\\left\\{ a \\right\\}")).toContain('<m:begChr m:val="{"/><m:endChr m:val="}"/>');
    expect(xml("\\left| c \\right|")).toContain('<m:begChr m:val="|"/><m:endChr m:val="|"/>');
    // 片側だけの括弧（\left. … \right|）
    expect(xml("\\left. x \\right|_0")).toContain('<m:sSub><m:e><m:d><m:dPr><m:begChr m:val=""/><m:endChr m:val="|"/></m:dPr>');
    expect(xml("\\left\\langle x \\middle| y \\right\\rangle")).toContain('<m:begChr m:val="⟨"/><m:sepChr m:val="|"/><m:endChr m:val="⟩"/>');
    const plain = xml("(a+b)[c]");
    expect(plain).not.toContain("<m:d>");
    expect(plain).toContain("<m:t>(a+b)[c]</m:t>");
  });

  it("文字（\\text）は普通の文字として入り、日本語も残る", () => {
    const out = xml("\\text{密度} = \\frac{m}{V}", true);
    expect(out).toContain("<m:r><m:rPr><m:nor/></m:rPr><m:t>密度</m:t></m:r>");
    expect(xml("\\textbf{xy}")).toContain("<m:rPr><m:nor/></m:rPr><w:rPr><w:b/></w:rPr><m:t>xy</m:t>");
    // 前後の空白を落とさない（KaTeX は \\text の中の空白を改行しない空白にする）
    const spaced = ommlToXml(latexToOmml("\\text{if } x", false)!);
    expect(spaced).toContain('<m:t xml:space="preserve">if\u00a0</m:t>');
  });

  it("関数名は立体になり、引数を取る", () => {
    expect(xml("\\sin x")).toContain('<m:func><m:fName><m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t>sin</m:t></m:r></m:fName><m:e><m:r><m:t>x</m:t></m:r></m:e></m:func>');
    expect(xml("\\exp(-x) + 1")).toMatch(/<m:func><m:fName>.*exp.*<\/m:fName><m:e><m:r><m:t>\(−x\)<\/m:t><\/m:r><\/m:e><\/m:func><m:r><m:t>\+1<\/m:t>/);
    expect(xml("\\lim_{x \\to 0} f", true)).toContain("<m:func><m:fName><m:limLow><m:e>");
    expect(xml("\\log_{10} y")).toContain("<m:func><m:fName><m:sSub>");
    // 引数が続かない関数名は、空の引数を作らず名前だけ
    const alone = xml("\\sin");
    expect(alone).not.toContain("<m:func>");
    expect(alone).toContain("sin");
  });

  it("上に載る記号・上線・下線", () => {
    expect(xml("\\hat{x}")).toContain('<m:acc><m:accPr><m:chr m:val="\u0302"/></m:accPr><m:e>');
    expect(xml("\\vec{v}")).toContain('<m:chr m:val="\u20d7"/>');
    expect(xml("\\dot{q}")).toContain('<m:chr m:val="\u0307"/>');
    expect(xml("\\tilde{x}")).toContain('<m:chr m:val="\u0303"/>');
    expect(xml("\\bar{y}")).toContain('<m:chr m:val="\u0304"/>');
    expect(xml("\\overline{AB}")).toContain('<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e><m:r><m:t>AB</m:t></m:r></m:e></m:bar>');
    expect(xml("\\underline{x}")).toContain('<m:barPr><m:pos m:val="bot"/></m:barPr>');
    // é・è（\acute・\grave）
    expect(xml("\\acute{x}")).toContain('<m:chr m:val="\u0301"/>');
    expect(xml("\\grave{x}")).toContain('<m:chr m:val="\u0300"/>');
    expect(latexToOmml("\\text{café}", false)).not.toBeNull();
  });

  it("二項係数は線の無い分数を括弧で包む", () => {
    expect(xml("\\binom{n}{k}")).toContain('<m:d><m:dPr><m:begChr m:val="("/><m:endChr m:val=")"/></m:dPr><m:e><m:f><m:fPr><m:type m:val="noBar"/></m:fPr>');
  });

  it("書体の指定", () => {
    expect(xml("\\mathrm{d}x")).toContain('<m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t>d</m:t></m:r><m:r><m:t>x</m:t></m:r>');
    expect(xml("\\mathbf{v}")).toContain('<m:sty m:val="b"/>');
    expect(xml("\\boldsymbol{\\sigma}")).toContain('<m:sty m:val="bi"/>');
    expect(xml("\\mathbb{R}")).toContain('<m:scr m:val="double-struck"/>');
    expect(xml("\\mathcal{L}")).toContain('<m:scr m:val="script"/>');
    // 続けて書いた立体の文字は 1 つにまとまる
    expect(xml("\\mathrm{kg}")).toContain("<m:t>kg</m:t>");
  });

  it("記号・空き・プライム", () => {
    expect(xml("a \\times b \\leq c \\neq d \\approx e \\to \\infty")).toMatch(/×.*≤.*≠.*≈.*→/);
    expect(xml("a \\quad b")).toContain("a\u2003b");
    // f' の ′ は上付きにしない
    const prime = xml("f'(x)");
    expect(prime).not.toContain("<m:sSup>");
    expect(prime).toContain("f′(x)");
    // 色の指定は落として、中身は残す
    expect(xml("\\color{red}{x} + 1")).toContain("x+1");
  });

  it("空の引数には幅ゼロの文字を入れる（Word が点線の四角を出さないように）", () => {
    const out = xml("{}^{2}X");
    expect(out).toContain("<m:sSup><m:e><m:r><m:t>\u200b</m:t></m:r></m:e>");
    expect(out).not.toContain("<m:e/>");
  });

  it("数式の文字には Word と同じ書体の指定が付く", () => {
    const raw = ommlToXml(latexToOmml("x", false)!);
    expect(raw).toBe(
      '<m:oMath><m:r><w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr><m:t xml:space="preserve">x</m:t></m:r></m:oMath>',
    );
  });
});

describe("LaTeX の文字に戻る式（null）", () => {
  const unsupported: [string, string][] = [
    ["行列", "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}"],
    ["複数行", "\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}"],
    ["場合分け", "\\begin{cases} 1 & x>0 \\\\ 0 & x\\le 0 \\end{cases}"],
    ["式番号", "a = b \\tag{2}"],
    ["改行", "a \\\\ b"],
    ["囲み", "\\boxed{y}"],
    ["打ち消し", "\\cancel{x}"],
    ["見えない場所取り", "\\phantom{x} + y"],
    ["化学式の命令", "\\ce{H2O}"],
    ["許可されていない命令", "\\href{https://example.com}{x}"],
    ["未定義の命令", "\\foo{x}"],
    ["添え字の中の複数行", "\\sum_{\\substack{i<n \\\\ j<m}} a"],
  ];
  for (const [name, latex] of unsupported) {
    it(name, () => {
      expect(latexToOmml(latex, true)).toBeNull();
      expect(latexToOmml(latex, false)).toBeNull();
    });
  }

  it("写せる部分があっても、1 か所でも写せなければ全体が null（一部だけの数式にしない）", () => {
    expect(latexToOmml("\\frac{a}{b}", true)).not.toBeNull();
    expect(latexToOmml("\\frac{a}{b} + \\boxed{c}", true)).toBeNull();
  });

  it("壊れた LaTeX・空・文字列でない入力・長すぎる式で例外にならない", () => {
    const broken = [
      "\\frac{a}{", "}", "{", "x^", "\\left( a", "\\right)", "a & b", "\\begin{matrix}", "$$", "\\", "#", "%",
      "", "   ", "\u0000\u0001", "\ud800",
    ];
    for (const latex of broken) {
      expect(() => latexToOmml(latex, true)).not.toThrow();
      expect(() => latexToOmml(latex, false)).not.toThrow();
    }
    for (const latex of ["\\frac{a}{", "", "   ", "\\left( a"]) expect(latexToOmml(latex, true)).toBeNull();
    for (const value of [undefined, null, 3, {}, []]) expect(latexToOmml(value, false)).toBeNull();
    expect(latexToOmml("x+".repeat(MAX_MATH_LATEX_LENGTH), false)).toBeNull();
  });

  it("中身が黙って欠ける式は作らない（数式にするなら全部、できなければ null）", () => {
    // \text の中に見えない区切り（U+2063）が混ざっていても、文字は残る
    const kept = ommlToXml(latexToOmml("\\text{abc\u2063def} + x", false)!);
    expect(kept).toContain(">abcdef</m:t>");
    // \! だけは出さない（Word に負の空きは無い）
    expect(ommlToXml(latexToOmml("x \\! y", false)!)).toContain(">xy</m:t>");
    // XML に入れられない文字を含む式は、空の数式にせず null
    for (const latex of ["\ufffe", "x + \\text{a\ufffeb}", "\\text{\u0001}y"]) expect(latexToOmml(latex, false)).toBeNull();
    // 背景・枠つきの箱は、枠を落とした数式にしない
    expect(latexToOmml("\\colorbox{red}{x} + 1", false)).toBeNull();
    expect(latexToOmml("\\fcolorbox{red}{blue}{x}", false)).toBeNull();
  });

  it("記号が上に載った総和は、上限つきの総和にしない", () => {
    const out = xml("\\hat{\\sum} x");
    expect(out).not.toContain("<m:nary>");
    expect(out).toContain("<m:acc>");
  });

  it("深い入れ子は例外にせず null", () => {
    const deep = "\\sqrt{".repeat(200) + "x" + "}".repeat(200);
    expect(() => latexToOmml(deep, true)).not.toThrow();
    expect(latexToOmml(deep, true)).toBeNull();
    // 浅い入れ子は数式になる
    expect(latexToOmml("\\sqrt{".repeat(5) + "x" + "}".repeat(5), true)).not.toBeNull();
  });
});

describe("MathML の読み取り", () => {
  it("実体参照を戻す", () => {
    const math = parseMathML('<math><mrow><mo>&lt;</mo><mtext>a&amp;b &#x41;&#66;</mtext><mspace width="1em"/></mrow></math>');
    const row = math.children[0];
    expect(row.children[0].text).toBe("<");
    expect(row.children[1].text).toBe("a&b AB");
    expect(row.children[2].attrs.width).toBe("1em");
  });

  it("壊れたマークアップは MathUnsupportedError", () => {
    for (const markup of ["", "<math>", "<math><mi>x</math>", "<math><mi>x</mi></mrow></math>", "x"]) {
      expect(() => mathMLToOmml(markup)).toThrow(MathUnsupportedError);
    }
  });

  it("< > & は数式の文字として残り、XML では逃がされる", () => {
    const out = ommlToXml(latexToOmml("a < b \\& c > d", false)!);
    expect(out).toContain(">a&lt;b</m:t>");
    expect(out).toContain(">&amp;</m:t>");
    expect(out).toContain(">c&gt;d</m:t>");
  });

  it("中身が空の式は null", () => {
    expect(mathMLToOmml("<math><semantics><mrow></mrow></semantics></math>")).toBeNull();
  });
});
