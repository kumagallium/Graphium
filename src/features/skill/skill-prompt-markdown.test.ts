// スキル本文 → AI に渡すプロンプト（extractSkillPrompt）のインラインの書き方のテスト
// リンク・インライン数式・上付き・下付きを落とさず、平文・太字・コードの出力は従来どおりに保つ

import { describe, it, expect } from "vitest";
import type { GraphiumDocument } from "../../lib/document-types";
import { buildSkillDocument, extractSkillPrompt } from "./skill-service";

const text = (t: string, styles: Record<string, boolean> = {}) => ({ type: "text", text: t, styles });
const link = (href: string, content: any) => ({ type: "link", href, content });
const math = (latex: string) => ({ type: "inlineMath", props: { latex } });

/** "Prompt Template" 見出しの後に、inline content を 1 つずつ持つ段落を並べたスキル文書 */
function skillWith(...paragraphs: any[][]): GraphiumDocument {
  const doc = buildSkillDocument("Test", "", "", true);
  const divider = doc.pages[0].blocks[0];
  return {
    ...doc,
    pages: [{
      ...doc.pages[0],
      blocks: [
        divider,
        ...paragraphs.map((content, i) => ({ id: `p${i}`, type: "paragraph", props: {}, content, children: [] })),
      ],
    }],
  };
}

describe("extractSkillPrompt のリンク", () => {
  it("[文字](URL) にする（[object Object] にしない）", () => {
    const prompt = extractSkillPrompt(skillWith([
      text("用語は "),
      link("https://www.w3.org/TR/prov-dm/", [text("PROV-DM")]),
      text(" に合わせる"),
    ]));
    expect(prompt).toBe("用語は [PROV-DM](https://www.w3.org/TR/prov-dm/) に合わせる");
    expect(prompt).not.toContain("[object Object]");
  });

  it("文字が URL そのもの（貼り付けた URL の自動リンク）なら URL を 1 回だけ書く", () => {
    const url = "https://gist.github.com/example/fd287c3133457c4f";
    expect(extractSkillPrompt(skillWith([text("参考: "), link(url, [text(url)])]))).toBe(`参考: ${url}`);
  });

  it("href が %エンコードされた自動リンクも文字だけにする", () => {
    // 全角の括弧・読点まで巻き込んだ自動リンク（実データにある形）
    const shown = "https://www.w3.org/TR/prov-dm/）、BlockNote.js（https://www.blocknotejs.org/";
    expect(extractSkillPrompt(skillWith([link(encodeURI(shown), [text(shown)])]))).toBe(shown);
  });

  it("href の無いリンクは文字だけ、文字の無いリンクは何も出さない", () => {
    expect(extractSkillPrompt(skillWith([link("", [text("手順書")])]))).toBe("手順書");
    expect(extractSkillPrompt(skillWith([text("a"), link("https://example.com", []), text("b")]))).toBe("ab");
  });

  it("リンクの文字の太字・コードも Markdown にする", () => {
    expect(extractSkillPrompt(skillWith([
      link("https://example.com/guide", [text("書式", { bold: true }), text(" の "), text("slug", { code: true })]),
    ]))).toBe("[**書式** の `slug`](https://example.com/guide)");
  });

  it("中身が文字列のリンク（部分ブロックの形）も文字を読む", () => {
    expect(extractSkillPrompt(skillWith([link("https://example.com", "ガイド")]))).toBe("[ガイド](https://example.com)");
  });
});

describe("extractSkillPrompt の数式・上付き・下付き", () => {
  it("インライン数式を $…$ にする（空文字にしない）", () => {
    expect(extractSkillPrompt(skillWith([text("濃度は "), math("10^{-3}"), text(" M の桁で書く")])))
      .toBe("濃度は $10^{-3}$ M の桁で書く");
  });

  it("上付き・下付きを <sup> / <sub> にする（10⁵ を 105 にしない）", () => {
    expect(extractSkillPrompt(skillWith([
      text("10"), text("5", { superscript: true }), text(" Pa の H"), text("2", { subscript: true }), text("O"),
    ]))).toBe("10<sup>5</sup> Pa の H<sub>2</sub>O");
  });

  it("太字の上付きは **<sup>…</sup>**、コードの中はタグを付けない", () => {
    expect(extractSkillPrompt(skillWith([
      text("x"), text("2", { bold: true, superscript: true }), text(" と "), text("a^b", { code: true, superscript: true }),
    ]))).toBe("x**<sup>2</sup>** と `a^b`");
  });

  it("文字を持たないインライン（画像など）は従来どおり何も出さない", () => {
    expect(extractSkillPrompt(skillWith([
      text("図 "), { type: "inlineImage", props: { fileId: "f1", name: "flow.png", width: 0 } }, text(" を参照"),
    ]))).toBe("図  を参照");
  });

  it("見出し・箇条書き・引用の中でも同じ書き方になる", () => {
    const doc = skillWith();
    doc.pages[0].blocks.push(
      { id: "h", type: "heading", props: { level: 3 }, content: [text("E = mc"), text("2", { superscript: true })], children: [] },
      { id: "b", type: "bulletListItem", props: {}, content: [text("式 "), math("\\alpha")], children: [] },
      { id: "q", type: "quote", props: {}, content: [link("https://example.com", [text("出典")])], children: [] },
    );
    expect(extractSkillPrompt(doc)).toBe("### E = mc<sup>2</sup>\n- 式 $\\alpha$\n> [出典](https://example.com)");
  });
});

describe("extractSkillPrompt の平文・太字・コード（従来どおり）", () => {
  it("書式の組み合わせと空の文字片を従来と同じ文字列にする", () => {
    expect(extractSkillPrompt(skillWith([
      text("a "), text("b", { bold: true }), text(""), text("c", { code: true }), text("d", { bold: true, code: true }),
      text(" e", { italic: true, underline: true }), { type: "text", text: "f" },
    ]))).toBe("a **b**`c`**`d`** ef");
  });

  it("既定プロンプトに書いたリンク・数式・タグの表記は、文字のまま往復して変わらない", () => {
    // Markdown → ブロックの変換はこれらを読まず文字のまま残し、抽出も平文を書き換えない
    const prompt = [
      "## 例",
      "",
      "- 用語は [PROV-DM](https://www.w3.org/TR/prov-dm/) に合わせる",
      "- 単位は $10^{-3}$ M、10<sup>5</sup> Pa のように書く",
      "- 金額の $100 と $200 はそのまま",
      "- **太字** と `[[source:id]]` と [[ZnO reduction 2026-04]]",
    ].join("\n");
    expect(extractSkillPrompt(buildSkillDocument("Test", "", prompt))).toBe(prompt);
  });
});
