// markdown-to-blocks.ts の変換ロジックの回帰テスト。
// scripts/claude-code-skill/save-to-graphium/save.mjs との重複実装であり、
// 末尾の describe で save.mjs を実際に動かし、同じ Markdown から同じブロックが出るかを突き合わせる。

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";
import { stashMath } from "../features/math/markdown-math";
import {
  markdownToBlocks,
  parseInlineContent,
  stashMathAndScripts,
  type Block,
} from "./markdown-to-blocks";
import { blocksToMarkdown } from "./note-text";

/** BlockNote のブロック content からプレーンテキストだけを取り出す小ヘルパー */
function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => {
      const item = c as Record<string, unknown>;
      if (typeof item.text === "string") return item.text;
      if (Array.isArray(item.content)) return textOf(item.content);
      return "";
    })
    .join("");
}

describe("markdownToBlocks", () => {
  it("見出しを heading ブロックに変換する", () => {
    const blocks = markdownToBlocks("# Title\n## Sub\n### SubSub");
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({ type: "heading" });
    expect((blocks[0].props as Record<string, unknown>).level).toBe(1);
    expect(textOf(blocks[0].content)).toBe("Title");
    expect((blocks[1].props as Record<string, unknown>).level).toBe(2);
    expect((blocks[2].props as Record<string, unknown>).level).toBe(3);
  });

  it("空行区切りの段落を paragraph ブロックに変換する", () => {
    const blocks = markdownToBlocks("Hello\nworld\n\nSecond paragraph");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("paragraph");
    expect(textOf(blocks[0].content)).toBe("Hello world");
    expect(textOf(blocks[1].content)).toBe("Second paragraph");
  });

  it("箇条書き（- と番号付き）を bulletListItem ブロックに変換する", () => {
    const blocks = markdownToBlocks("- item1\n* item2\n1. item3");
    expect(blocks).toHaveLength(3);
    for (const b of blocks) {
      expect(b.type).toBe("bulletListItem");
    }
    expect(textOf(blocks[0].content)).toBe("item1");
    expect(textOf(blocks[1].content)).toBe("item2");
    expect(textOf(blocks[2].content)).toBe("item3");
  });

  it("フェンス付きコードブロックを codeBlock に変換する（インライン装飾は解釈しない）", () => {
    const blocks = markdownToBlocks(
      "```ts\nconst a = 1;\n**not bold**\n```",
    );
    expect(blocks).toHaveLength(1);
    const block = blocks[0] as Block;
    expect(block.type).toBe("codeBlock");
    expect((block.props as Record<string, unknown>).language).toBe("ts");
    const content = block.content as Array<Record<string, unknown>>;
    expect(content[0].text).toBe("const a = 1;\n**not bold**");
    expect(content[0].styles).toEqual({});
  });

  it("テーブルを table ブロックに変換する", () => {
    const md = "| a | b |\n|---|---|\n| 1 | 2 |";
    const blocks = markdownToBlocks(md);
    expect(blocks).toHaveLength(1);
    const block = blocks[0] as Block;
    expect(block.type).toBe("table");
    const content = block.content as { rows: Array<{ cells: unknown[][] }> };
    expect(content.rows).toHaveLength(2);
    expect(textOf(content.rows[0].cells[0])).toBe("a");
    expect(textOf(content.rows[0].cells[1])).toBe("b");
    expect(textOf(content.rows[1].cells[0])).toBe("1");
    expect(textOf(content.rows[1].cells[1])).toBe("2");
  });

  it("空の Markdown からは空 paragraph 1件を返す", () => {
    const blocks = markdownToBlocks("");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("paragraph");
    expect(textOf(blocks[0].content)).toBe("");
  });
});

describe("parseInlineContent", () => {
  it("太字を bold スタイルとして解釈する", () => {
    const result = parseInlineContent("**bold text**");
    expect(result).toEqual([
      { type: "text", text: "bold text", styles: { bold: true } },
    ]);
  });

  it("斜体を italic スタイルとして解釈する", () => {
    const result = parseInlineContent("*italic text*");
    expect(result).toEqual([
      { type: "text", text: "italic text", styles: { italic: true } },
    ]);
  });

  it("インラインコードを code スタイルとして解釈する", () => {
    const result = parseInlineContent("`code`");
    expect(result).toEqual([
      { type: "text", text: "code", styles: { code: true } },
    ]);
  });

  it("リンクを link ノードとして解釈する", () => {
    const result = parseInlineContent("[label](https://example.com)");
    expect(result).toEqual([
      {
        type: "link",
        href: "https://example.com",
        content: [{ type: "text", text: "label", styles: {} }],
      },
    ]);
  });

  it("装飾が混在するテキストを複数ノードに分解する", () => {
    const result = parseInlineContent("plain **bold** and `code` end");
    expect(textOf(result)).toBe("plain bold and code end");
    expect(result.some((r) => (r as any).styles?.bold)).toBe(true);
    expect(result.some((r) => (r as any).styles?.code)).toBe(true);
  });
});

/** ブロック ID は毎回ランダムなので伏せて比べる */
function withoutIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutIds);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "id")
        .map(([key, v]) => [key, withoutIds(v)]),
    );
  }
  return value;
}

const text = (t: string, styles: Record<string, unknown> = {}) => ({ type: "text", text: t, styles });
const math = (latex: string) => ({ type: "inlineMath", props: { latex } });
const hasInlineMath = (content: unknown) =>
  Array.isArray(content) && content.some((c) => (c as Record<string, unknown>).type === "inlineMath");

describe("数式", () => {
  it("$…$ と \\(…\\) をインライン数式にする", () => {
    expect(parseInlineContent("式 $x^2 + y^2$ と \\(a_1\\) を使う")).toEqual([
      text("式 "),
      math("x^2 + y^2"),
      text(" と "),
      math("a_1"),
      text(" を使う"),
    ]);
  });

  it("金額・価格帯や、内側に空白のある $ は数式にしない", () => {
    for (const src of [
      "価格は $100 から $200 に上がった",
      "1 kg あたり $50-$75 で買える",
      "($5/$10)",
      "US$50-$75",
      "$ x $ と $y $",
      "\\$5 と \\$6",
    ]) {
      const content = parseInlineContent(src);
      expect(hasInlineMath(content)).toBe(false);
      expect(textOf(content)).toBe(src);
    }
  });

  it("式の中の * や _ を強調として拾わない", () => {
    expect(parseInlineContent("$a*b*c$ と $x_1 * y_2$")).toEqual([
      math("a*b*c"),
      text(" と "),
      math("x_1 * y_2"),
    ]);
  });

  it("インライン数式は 200 字まで（それより長いものは文字のまま）", () => {
    expect(hasInlineMath(parseInlineContent(`$${"a".repeat(200)}$`))).toBe(true);
    expect(hasInlineMath(parseInlineContent(`$${"a".repeat(201)}$`))).toBe(false);
  });

  it("行に単独の $$ … $$ を数式ブロックにする（get_note が書く形）", () => {
    const blocks = markdownToBlocks("前の段落\n\n$$ E = mc^2 $$\n\n後の段落");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "math", "paragraph"]);
    expect(blocks[1]).toEqual({
      id: expect.any(String),
      type: "math",
      props: { latex: "E = mc^2" },
      children: [],
    });
  });

  it("複数行の $$ … $$ と \\[ … \\] は、段落に続けて書かれていても数式ブロックにする", () => {
    const blocks = markdownToBlocks(
      [
        "定義は次のとおり。",
        "$$",
        "S = -\\frac{\\Delta V}{\\Delta T}",
        "$$",
        "ここで ΔV は電圧差。",
        "\\[",
        "a = 1 \\\\",
        "b = 2",
        "\\]",
      ].join("\n"),
    );
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "math", "paragraph", "math"]);
    expect(textOf(blocks[0].content)).toBe("定義は次のとおり。");
    expect(blocks[1].props).toEqual({ latex: "S = -\\frac{\\Delta V}{\\Delta T}" });
    expect(textOf(blocks[2].content)).toBe("ここで ΔV は電圧差。");
    // 式の中の改行（行列の \\ など）はそのまま残す
    expect(blocks[3].props).toEqual({ latex: "a = 1 \\\\\nb = 2" });
  });

  it("文中・見出し・箇条書き・表のセルの $$ … $$ は行を割らずにインライン数式にする", () => {
    const blocks = markdownToBlocks(
      [
        "エネルギーは $$E = mc^2$$ で与えられる。",
        "",
        "## 式 $$x$$",
        "",
        "- 項目 $$y$$",
        "",
        "| a | $$z$$ |",
        "|---|---|",
        "| 1 | 2 |",
      ].join("\n"),
    );
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "heading", "bulletListItem", "table"]);
    expect(blocks[0].content).toEqual([text("エネルギーは "), math("E = mc^2"), text(" で与えられる。")]);
    expect(blocks[1].content).toEqual([text("式 "), math("x")]);
    expect(blocks[2].content).toEqual([text("項目 "), math("y")]);
    const rows = (blocks[3].content as { rows: Array<{ cells: unknown[][] }> }).rows;
    expect(rows[0].cells[1]).toEqual([math("z")]);
  });

  it("コードの中の $ は数式にしない", () => {
    const blocks = markdownToBlocks("`$x$` は数式ではない\n\n```latex\n$$ E = mc^2 $$\n$y$\n```");
    expect(blocks[0].content).toEqual([text("$x$", { code: true }), text(" は数式ではない")]);
    expect(blocks[1]).toMatchObject({
      type: "codeBlock",
      content: [text("$$ E = mc^2 $$\n$y$")],
    });
  });

  it("閉じていないフェンスの中身も、拾った数式を元の表記に戻して残す", () => {
    const blocks = markdownToBlocks("```\n$$\nx\n$$\n\\(y\\)");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "codeBlock", content: [text("$$\nx\n$$\n\\(y\\)")] });
  });

  it("本文に私用領域の文字（アイコンフォント由来など）があっても、数式の目印と取り違えない", () => {
    const pua = `${String.fromCharCode(0xe000)}0${String.fromCharCode(0xe001)}`;
    expect(parseInlineContent(`$a$ と ${pua}`)).toEqual([math("a"), text(` と ${pua}`)]);
  });

  it("アプリの Markdown 取り込み（stashMath）と同じものを数式として拾う", () => {
    for (const src of [
      "式 $x^2$ と $$ E = mc^2 $$ と \\[ a \\] と \\( b \\)",
      "$x$-軸と $y$、$n$個",
      "価格は $100 から $200、$50–$75、($5/$10)",
      "`$code$` と ```\n$$ fenced $$\n``` と ~~~\n$t$\n~~~ の外の $out$",
      "$$\n\\begin{pmatrix} 1 & 0 \\\\ 0 & 1 \\end{pmatrix}\n$$",
      "空の $$ $$ と $ $ と \\( \\)",
      `長い $${"a".repeat(201)}$ と短い $b$`,
      "\\$5 と a$b$ と $c$d",
    ]) {
      const mine = stashMathAndScripts(src)
        .stash.filter((e) => e.kind === "math")
        .map((e) => (e.kind === "math" ? { latex: e.latex, display: e.display } : null));
      expect(mine, src).toEqual(stashMath(src).math);
    }
  });
});

describe("上付き・下付き", () => {
  it("<sup> / <sub> を上付き・下付きの書式にする", () => {
    expect(parseInlineContent("10<sup>5</sup> Pa と H<sub>2</sub>O")).toEqual([
      text("10"),
      text("5", { superscript: true }),
      text(" Pa と H"),
      text("2", { subscript: true }),
      text("O"),
    ]);
  });

  it("タグの中の、書き出し側のエスケープを戻す（\\[1\\] は数式にしない）", () => {
    expect(
      parseInlineContent("p<sup>\\*</sup> と q<sup>\\*</sup>、文献<sup>\\[1\\]</sup>、<sub>a&lt;b &amp; c</sub>"),
    ).toEqual([
      text("p"),
      text("*", { superscript: true }),
      text(" と q"),
      text("*", { superscript: true }),
      text("、文献"),
      text("[1]", { superscript: true }),
      text("、"),
      text("a<b & c", { subscript: true }),
    ]);
  });

  it("タグの中の * は、外の * と組になって斜体を作らない", () => {
    expect(parseInlineContent("p* と q<sup>\\*</sup>")).toEqual([
      text("p* と q"),
      text("*", { superscript: true }),
    ]);
  });

  it("太字・斜体・リンクの中の上付き・下付きも書式にする", () => {
    expect(parseInlineContent("**10<sup>5</sup> Pa** と *x<sub>i</sub>*")).toEqual([
      text("10", { bold: true }),
      text("5", { bold: true, superscript: true }),
      text(" Pa", { bold: true }),
      text(" と "),
      text("x", { italic: true }),
      text("i", { italic: true, subscript: true }),
    ]);
    expect(parseInlineContent("[H<sub>2</sub>O](https://example.com)")).toEqual([
      {
        type: "link",
        href: "https://example.com",
        content: [text("H"), text("2", { subscript: true }), text("O")],
      },
    ]);
  });

  it("リンクの中の数式は、inlineMath を置けないので元の表記の文字で残す", () => {
    expect(parseInlineContent("[式 $x$ の説明](https://example.com)")).toEqual([
      { type: "link", href: "https://example.com", content: [text("式 $x$ の説明")] },
    ]);
  });

  it("コードの中・行をまたぐ・表の区切りを含むタグは文字のまま残す", () => {
    expect(parseInlineContent("`<sup>x</sup>`")).toEqual([text("<sup>x</sup>", { code: true })]);
    expect(parseInlineContent("<sup>a|b</sup>")).toEqual([text("<sup>a|b</sup>")]);
    expect(markdownToBlocks("<sup>a\nb</sup>")[0].content).toEqual([text("<sup>a b</sup>")]);
  });
});

describe("get_note の表記を読み戻す", () => {
  it("note-text.ts が書いた Markdown から、元のブロックに戻る", () => {
    const original: Block[] = [
      {
        id: "h",
        type: "heading",
        props: { textColor: "default", backgroundColor: "default", textAlignment: "left", level: 2 },
        content: [text("H"), text("2", { subscript: true }), text("O の生成")],
        children: [],
      },
      {
        id: "p",
        type: "paragraph",
        props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
        content: [
          text("圧力 10"),
          text("5", { superscript: true }),
          text(" Pa、式 "),
          math("E = mc^2"),
          text("、文献"),
          text("[1]", { superscript: true }),
          text("。p"),
          text("*", { superscript: true }),
          text(" と a"),
          text("<b & c>", { subscript: true }),
        ],
        children: [],
      },
      { id: "m", type: "math", props: { latex: "\\int_0^1 x\\,dx = \\frac{1}{2}" }, children: [] },
      {
        id: "li",
        type: "bulletListItem",
        props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
        content: [text("温度 T"), text("c", { subscript: true }), text(" は "), math("T_c"), text(" と同じ")],
        children: [],
      },
      {
        id: "t",
        type: "table",
        content: {
          type: "tableContent",
          rows: [
            { cells: [[text("a")], [text("b")]] },
            { cells: [[text("x"), text("2", { superscript: true })], [math("\\alpha")]] },
          ],
        },
        children: [],
      },
      {
        id: "c",
        type: "codeBlock",
        props: { language: "latex" },
        content: [text("$$ E $$ と <sup>x</sup>")],
        children: [],
      },
    ];
    const md = blocksToMarkdown(original);
    expect(withoutIds(markdownToBlocks(md))).toEqual(withoutIds(original));
  });
});

// ── save.mjs との突き合わせ ──

const SAVE_MJS = fileURLToPath(
  new URL("../../scripts/claude-code-skill/save-to-graphium/save.mjs", import.meta.url),
);

/** save.mjs を実際に動かし、書き込まれたノートのブロックを返す（書き込み先は一時ディレクトリ） */
function blocksFromSaveMjs(body: string): unknown {
  const dir = mkdtempSync(join(tmpdir(), "graphium-save-mjs-"));
  try {
    const out = execFileSync(process.execPath, [SAVE_MJS], {
      input: JSON.stringify({ title: "t", body }),
      env: { ...process.env, GRAPHIUM_NOTES_DIR: dir },
      encoding: "utf8",
    });
    const { filePath } = JSON.parse(out) as { filePath: string };
    return JSON.parse(readFileSync(filePath, "utf8")).pages[0].blocks;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("save.mjs と同じブロックを出す", () => {
  const fixtures: Record<string, string> = {
    空: "",
    従来の記法: [
      "# 見出し",
      "本文と **強調** と *斜体* と `code` と [リンク](https://example.com)。",
      "続きの行",
      "",
      "- 箇条書き",
      "1. 番号付き",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "```ts",
      "const a = 1;",
      "```",
    ].join("\n"),
    数式: [
      "式 $x^2$ と \\(a_1\\)、行の中の $$E$$。",
      "定義:",
      "$$",
      "S = -\\frac{\\Delta V}{\\Delta T}",
      "$$",
      "\\[ a^2 + b^2 = c^2 \\]",
      "",
      "## 見出しの $y$",
      "- 項目 $$z$$",
      "",
      "| 式 | 値 |",
      "|---|---|",
      "| $\\alpha$ | $$\\beta$$ |",
    ].join("\n"),
    金額とコード: [
      "価格は $100 から $200、$50-$75、($5/$10)、US$50-$75、\\$5。",
      "`$x$` と",
      "```latex",
      "$$ E = mc^2 $$",
      "```",
      "~~~",
      "$t$",
      "~~~",
      `ちょうど 200 字 $${"a".repeat(200)}$ と 201 字 $${"b".repeat(201)}$`,
    ].join("\n"),
    上付き下付き: [
      "10<sup>5</sup> Pa と H<sub>2</sub>O、文献<sup>\\[1\\]</sup>、p<sup>\\*</sup> と q<sup>\\*</sup>。",
      "**太字の 10<sup>5</sup>** と *x<sub>i</sub>* と [H<sub>2</sub>O](https://example.com) と [式 $x$](https://example.com)。",
      "<sub>a&lt;b &amp; c</sub> と <SUP class=\"x\">大文字</SUP> と <sup>a|b</sup> と `<sup>x</sup>`",
      "<sup>行を",
      "またぐ</sup>",
      "",
      "| <sup>1</sup> | H<sub>2</sub> |",
      "|---|---|",
    ].join("\n"),
    閉じていないフェンス: "本文\n```\n$$\nx\n$$\n<sup>y</sup>",
    私用領域の文字: `$a$ と ${String.fromCharCode(0xe000)}0${String.fromCharCode(0xe001)} と <sup>b</sup>`,
    改行コード: "a $x$\r\n$$\r\ny\r\n$$\r\nb",
  };

  for (const [name, body] of Object.entries(fixtures)) {
    it(name, () => {
      expect(withoutIds(blocksFromSaveMjs(body))).toEqual(withoutIds(markdownToBlocks(body)));
    });
  }
});
