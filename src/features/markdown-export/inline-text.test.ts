import { describe, expect, it } from "vitest";
import { inlineContentToText } from "./inline-text";

// 10⁵ Pa のように、上付きの片を含む行
const withSuperscript = [
  { type: "text", text: "10", styles: {} },
  { type: "text", text: "5", styles: { superscript: true } },
  { type: "text", text: " Pa", styles: {} },
];

describe("inlineContentToText", () => {
  it("平文（既定）では上付き・下付きのタグを入れない", () => {
    expect(inlineContentToText(withSuperscript)).toBe("105 Pa");
  });

  it("scripts: true では上付き・下付きを <sup> / <sub> で包む", () => {
    expect(inlineContentToText(withSuperscript, { scripts: true })).toBe("10<sup>5</sup> Pa");
    const water = [
      { type: "text", text: "H", styles: {} },
      { type: "text", text: "2", styles: { subscript: true } },
      { type: "text", text: "O", styles: {} },
    ];
    expect(inlineContentToText(water, { scripts: true })).toBe("H<sub>2</sub>O");
  });

  it("上付きと他の書式が重なっていても包む（太字などの書式自体は文字にしない）", () => {
    const content = [{ type: "text", text: "n", styles: { superscript: true, bold: true } }];
    expect(inlineContentToText(content, { scripts: true })).toBe("<sup>n</sup>");
  });

  it("タグの中で Markdown 記法になる文字はエスケープする（Markdown 書き出しと同じ表記）", () => {
    const content = [
      { type: "text", text: "p", styles: {} },
      { type: "text", text: "*", styles: { superscript: true } },
    ];
    expect(inlineContentToText(content, { scripts: true })).toBe("p<sup>\\*</sup>");
  });

  it("inlineMath はどちらの出し分けでも $…$ にする", () => {
    const content = [
      { type: "text", text: "式 ", styles: {} },
      { type: "inlineMath", props: { latex: " E = mc^2 " } },
    ];
    expect(inlineContentToText(content)).toBe("式 $E = mc^2$");
    expect(inlineContentToText(content, { scripts: true })).toBe("式 $E = mc^2$");
  });

  it("空の inlineMath は何も出さない", () => {
    expect(inlineContentToText([{ type: "inlineMath", props: { latex: "" } }])).toBe("");
  });

  it("リンクは中身の文字だけを出し、中の上付きも包む", () => {
    const content = [
      {
        type: "link",
        href: "https://example.com",
        content: [
          { type: "text", text: "Fig", styles: {} },
          { type: "text", text: "a", styles: { superscript: true } },
        ],
      },
    ];
    expect(inlineContentToText(content)).toBe("Figa");
    expect(inlineContentToText(content, { scripts: true })).toBe("Fig<sup>a</sup>");
  });

  it("文字を持たない inline（インライン画像）は落とす", () => {
    const content = [
      { type: "text", text: "図", styles: {} },
      { type: "inlineImage", props: { fileId: "f1", name: "x.png" } },
    ];
    expect(inlineContentToText(content, { scripts: true })).toBe("図");
  });

  it("配列でなければ空文字", () => {
    expect(inlineContentToText(undefined)).toBe("");
    expect(inlineContentToText("text")).toBe("");
  });
});
