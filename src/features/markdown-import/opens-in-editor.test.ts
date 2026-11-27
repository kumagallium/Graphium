// @vitest-environment jsdom
//
// 取り込んだ md が、アプリと同じスキーマのエディタで開けるか（回帰ガード）。
//
// BlockNote は initialContent が 1 か所でもスキーマに合わないとエディタの生成で throw し、
// 「画面を表示できなくなりました」になる。再読み込みしても同じノートを開いて落ち続ける。
// 実際に `[$x$](url)`（リンクの中の数式）で起きた。取り込み → 読込サニタイズ → 生成を
// 書き方ごとに通し、どれも開けることを見る。スキーマは base/editor.tsx の SandboxEditor と揃える。
import { describe, it, expect, vi } from "vitest";
vi.mock("react-pdf", () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {} } }));
vi.mock("../../lib/pdfjs-config", () => ({}));
import { BlockNoteEditor, BlockNoteSchema, createCodeBlockSpec, createHeadingBlockSpec, defaultBlockSpecs, defaultStyleSpecs, defaultInlineContentSpecs } from "@blocknote/core";
import { codeBlockOptions } from "@blocknote/code-block";
import { customBlockEntries, sanitizeBlocksForLoad, KNOWN_INLINE_TYPES } from "../../blocks/registry";
import { gatedMediaBlockEntries } from "../../blocks/remote-content/gated-media-spec";
import { inlineMathSpecs } from "../inline-math/spec";
import { inlineImageSpecs } from "../inline-image/spec";
import { inlineLabelStyleSpecs } from "../inline-label/styles";
import { scriptStyleSpecs } from "../../base/script-styles";
import { importMarkdownToGraphiumDoc } from "./import";
import { repairBlocksForSchema } from "../../base/repair-initial-content";

const spec = (b: any) => (typeof b.spec === "function" ? b.spec() : b.spec);
const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    codeBlock: createCodeBlockSpec(codeBlockOptions),
    heading: createHeadingBlockSpec({ allowToggleHeadings: false }),
    ...Object.fromEntries(customBlockEntries.map((b) => [b.type, spec(b)])),
    ...Object.fromEntries(gatedMediaBlockEntries.map((b) => [b.type, spec(b)])),
  } as any,
  inlineContentSpecs: { ...defaultInlineContentSpecs, ...inlineMathSpecs, ...inlineImageSpecs } as any,
  styleSpecs: { ...defaultStyleSpecs, ...inlineLabelStyleSpecs, ...scriptStyleSpecs } as any,
});
// note-app.tsx の sanitizeInlineContent と同じ（未知の inline を落とす）
const sanitizeInline = (content: any) => Array.isArray(content) ? content.filter((c: any) => !c.type || KNOWN_INLINE_TYPES.has(c.type)) : content;

const samples: Record<string, string> = {
  basic: "# T\n\npara **b** *i* `c`\n\n- a\n- b\n  - c\n\n1. x\n2. y\n",
  h456: "#### h4\n\n##### h5\n\n###### h6\n",
  table: "| a | b |\n|---|---|\n| 1 | 2 |\n",
  tableInline: "| a | b |\n|---|---|\n| **1** `x` | [l](http://x) |\n",
  tableImg: "| a |\n|---|\n| ![i](http://x/a.png) |\n",
  tableBr: "| a |\n|---|\n| x<br>y |\n",
  tableMath: "| a |\n|---|\n| $x^2$ |\n",
  tableList: "| a | b |\n|---|---|\n| - x | 2 |\n",
  tableRagged: "| a | b | c |\n|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 |\n",
  check: "- [ ] todo\n- [x] done\n",
  quote: "> q\n> > nested\n",
  quoteList: "> - a\n> - b\n",
  quoteHeading: "> # h\n> para\n",
  code: "```js\nx\n```\n\n```unknownlang\ny\n```\n\n```\nz\n```\n",
  codeInList: "- a\n  ```\n  code\n  ```\n",
  hr: "a\n\n---\n\nb\n",
  img: "![alt](http://x/a.png)\n\ntext ![inline](http://x/b.png) more\n",
  imgInList: "- ![x](http://x/a.png)\n",
  imgInHeading: "# ![x](http://x/a.png) title\n",
  imgInQuote: "> ![x](http://x/a.png)\n",
  html: "<div><p>x</p><table><tr><td>a</td></tr></table></div>\n",
  details: "<details><summary>s</summary>\n\nbody\n\n</details>\n",
  math: "$$\nx^2\n$$\n\ninline $a+b$ here\n",
  mathInList: "- $$x$$\n- $y$\n",
  mathInHeading: "# $x$ title\n",
  mathInQuote: "> $$\n> x\n> $$\n",
  mathInTable: "| a |\n|---|\n| $$x$$ |\n",
  footnote: "a[^1]\n\n[^1]: note\n",
  frontmatter: "---\ntitle: x\n---\n\nbody\n",
  wikilink: "[[Note]] and ![[img.png]]\n",
  sup: "x<sup>2</sup> H<sub>2</sub>O\n",
  deepList: "- a\n    - b\n        - c\n            - d\n",
  listHeading: "- # h\n",
  listQuote: "- > q\n",
  listTable: "- a\n\n  | x |\n  |---|\n  | 1 |\n",
  quoteTable: "> | x |\n> |---|\n> | 1 |\n",
  quoteCode: "> ```\n> c\n> ```\n",
  hardbreak: "a  \nb\\\nc\n",
  strike: "~~s~~ <u>u</u> <mark>m</mark>\n",
  emptyLink: "[](http://x)\n",
  autolink: "<http://x> http://y\n",
  video: "![v](http://x/a.mp4)\n",
  audio: "![v](http://x/a.mp3)\n",
  linkImg: "[![i](http://x/a.png)](http://y)\n",
  emoji: "😀 :smile:\n",
  htmlColspan: "<table><tr><td colspan=2>a</td></tr><tr><td>1</td><td>2</td></tr></table>\n",
  htmlNestedTable: "<table><tr><td><table><tr><td>x</td></tr></table></td></tr></table>\n",
  htmlTdList: "<table><tr><td><ul><li>a</li></ul></td></tr></table>\n",
  htmlTdHeading: "<table><tr><td><h1>a</h1><p>b</p></td></tr></table>\n",
  htmlTh: "<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>\n",
  htmlImg: "text <img src=\"http://x/a.png\"> more\n",
  htmlCheckbox: "<input type=\"checkbox\" checked> x\n",
  htmlPre: "<pre><code>x\ny</code></pre>\n",
  htmlFigure: "<figure><img src=\"http://x/a.png\"><figcaption>c</figcaption></figure>\n",
  htmlIframe: "<iframe src=\"http://x\"></iframe>\n",
  htmlVideo: "<video src=\"http://x/a.mp4\"></video>\n",
  htmlAudio: "<audio src=\"http://x/a.mp3\"></audio>\n",
  htmlHeadingImg: "<h2><img src=\"http://x/a.png\"> t</h2>\n",
  htmlLiImg: "<ul><li><img src=\"http://x/a.png\"></li></ul>\n",
  htmlBlockquoteTable: "<blockquote><table><tr><td>a</td></tr></table></blockquote>\n",
  htmlLiTable: "<ul><li><table><tr><td>a</td></tr></table></li></ul>\n",
  htmlLiPre: "<ul><li><pre>x</pre></li></ul>\n",
  htmlHr: "<p>a<hr>b</p>\n",
  htmlDl: "<dl><dt>a</dt><dd>b</dd></dl>\n",
  htmlSpanStyle: "<span style=\"color:red;background:yellow\">x</span>\n",
  htmlFont: "<font color=red>x</font>\n",
  htmlKbd: "<kbd>a</kbd> <code>b</code> <s>c</s> <ins>d</ins>\n",
  htmlEmptyTable: "<table></table>\n",
  htmlEmptyTr: "<table><tr></tr></table>\n",
  mdTableEmptyCells: "| | |\n|---|---|\n| | |\n",
  mdTableOnlyHeader: "| a | b |\n|---|---|\n",
  crlf: "# a\r\n\r\n- b\r\n- c\r\n",
  nul: "a\u0000b\n",
  ctrl: "a\u0008b\u001bc\n",
  tabs: "\tcode\n\n- a\n\t- b\n",
  setext: "Title\n=====\n\nSub\n---\n",
  imgInTableCellList: "| a |\n|---|\n| <ul><li>x</li></ul> |\n",
  mathBlockInList: "- a\n\n  $$\n  x\n  $$\n",
  mathInLink: "[$x$](http://y)\n",
  mathInStrong: "**$x$ y**\n",
  mathTable2: "| $a$ | $$b$$ |\n|---|---|\n| \\(c\\) | \\[d\\] |\n",
  mathHeading2: "## \\[x\\]\n",
  mathQuote2: "> \\[x\\]\n",
  mathInLinkBlock: "[$$x$$](http://y)\n",
  supInLink: "[x<sup>2</sup>](http://y)\n",
  supInHeading: "# H<sub>2</sub>O\n",
  supInTable: "| H<sub>2</sub>O |\n|---|\n| x<sup>2</sup> |\n",
  supNested: "<sup><sub>x</sub></sup>\n",
  supUnclosed: "x<sup>2\n\ny</sup>\n",
  wikiInTable: "| [[A]] |\n|---|\n| [[B\\|b]] |\n",
  footnoteMulti: "a[^x]\n\n[^x]: - list\n    more\n",
  emptyFile: "",
  onlyFrontmatter: "---\na: 1\n---\n",
  frontmatterOnlyDashes: "---\n---\n",
  linkRef: "[a][1]\n\n[1]: http://x\n",
  imageRef: "![a][1]\n\n[1]: http://x/a.png\n",
  htmlComment: "<!-- c -->\n\na\n",
  htmlScript: "<script>alert(1)</script>\n<style>p{}</style>\n",
  toggleDetailsNested: "<details><summary>s</summary><ul><li>x</li></ul><table><tr><td>a</td></tr></table></details>\n",
  checkNested: "- [ ] a\n  - [x] b\n    1. c\n",
  checkInQuote: "> - [ ] a\n",
  checkHeading: "- [ ] # h\n",
  tableInTable: "| a |\n|---|\n| <table><tr><td>x</td></tr></table> |\n",
  imgLinkInTable: "| [![i](http://x/a.png)](http://y) |\n|---|\n| a |\n",
  mathImgTable: "| ![i](http://x/a.png) $x$ |\n|---|\n| a |\n",
  bigNested: "1. a\n   - b\n     > c\n     ```\n     d\n     ```\n",
};

describe("取り込んだ md がエディタで開ける", () => {
  for (const [name, md] of Object.entries(samples)) {
    it(name, async () => {
      const file = new File([md], `${name}.md`, { type: "text/markdown" });
      const { doc } = await importMarkdownToGraphiumDoc(file);
      const blocks = sanitizeBlocksForLoad(doc.pages[0].blocks as any[], sanitizeInline);
      let err: any = null;
      try { BlockNoteEditor.create({ schema, initialContent: blocks } as any); } catch (e) { err = e; }
      expect(err?.cause?.message ?? err?.message ?? null).toBeNull();
    });
  }
});

describe("リンクの中の数式", () => {
  it("取り込みでは $x$ の文字としてリンクに残す", async () => {
    const file = new File(["価格は [$x$ の式](https://example.com) です\n"], "m.md", { type: "text/markdown" });
    const { doc } = await importMarkdownToGraphiumDoc(file);
    const link = (doc.pages[0].blocks as any[])[0].content.find((c: any) => c.type === "link");
    expect(link.content.every((c: any) => c.type === "text")).toBe(true);
    expect(link.content.map((c: any) => c.text).join("")).toBe("$x$ の式");
  });

  // v0.173.7 までの取り込みで保存されたノート。読み込みで直して開けるようにする
  it("保存済みのノートは読み込み時に文字へ戻して開ける", () => {
    const saved = [{
      id: "p", type: "paragraph", props: {}, children: [],
      content: [{ type: "link", href: "https://example.com", content: [{ type: "inlineMath", props: { latex: "x" } }, { type: "text", text: " 式", styles: {} }] }],
    }];
    expect(() => BlockNoteEditor.create({ schema, initialContent: saved } as any)).toThrow(/initialContent/);
    const blocks = sanitizeBlocksForLoad(saved, sanitizeInline);
    expect(blocks[0].content[0].content.map((c: any) => c.text).join("")).toBe("$x$ 式");
    expect(() => BlockNoteEditor.create({ schema, initialContent: blocks } as any)).not.toThrow();
  });
});

describe("repairBlocksForSchema（知らない壊れ方への安全網）", () => {
  // 読込サニタイズが知らない壊れ方: 段落の中に段落（inline でないもの）が入っている
  const broken = { id: "bad", type: "paragraph", props: {}, children: [], content: [{ type: "text", text: "残す文字", styles: {} }, { type: "paragraph", content: "x" }] };
  const good = { id: "ok", type: "paragraph", props: {}, children: [], content: [{ type: "text", text: "そのまま", styles: {} }] };

  it("合わないブロックだけを文字の段落にし、ほかは触らない", () => {
    expect(() => BlockNoteEditor.create({ schema, initialContent: [good, broken] } as any)).toThrow(/initialContent/);
    const { blocks, replaced } = repairBlocksForSchema(schema, [good, broken]);
    expect(replaced).toBe(1);
    expect(blocks[0]).toBe(good);
    expect(blocks[1]).toMatchObject({ id: "bad", type: "paragraph", content: [{ type: "text", text: "残す文字" }] });
    expect(() => BlockNoteEditor.create({ schema, initialContent: blocks } as any)).not.toThrow();
  });

  it("子だけが合わないときは親を残して子を直す", () => {
    const parent = { id: "li", type: "bulletListItem", props: {}, content: [{ type: "text", text: "親", styles: {} }], children: [broken] };
    const { blocks, replaced } = repairBlocksForSchema(schema, [parent]);
    expect(replaced).toBe(1);
    expect(blocks[0]).toMatchObject({ id: "li", type: "bulletListItem", children: [{ id: "bad", type: "paragraph" }] });
    expect(() => BlockNoteEditor.create({ schema, initialContent: blocks } as any)).not.toThrow();
  });
});
