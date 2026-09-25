import { describe, expect, it } from "vitest";
import { inlineContentToText, tableContentToText } from "./inline-text";

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

describe("tableContentToText", () => {
  const text = (s: string, styles: Record<string, unknown> = {}) => ({ type: "text", text: s, styles });
  // BlockNote 0.47 からのセル（{ type: "tableCell", content }）
  const cell = (...content: unknown[]) => ({ type: "tableCell", props: {}, content });

  it("表の 1 行を 1 行にし、セルを | で区切る（新しいセルの形）", () => {
    const content = {
      type: "tableContent",
      rows: [
        { cells: [cell(text("試料")), cell(text("温度 (K)"))] },
        { cells: [cell(text("A")), cell(text("300"))] },
      ],
    };
    expect(tableContentToText(content)).toBe("試料 | 温度 (K)\nA | 300");
  });

  it("以前のセルの形（inline の配列）も同じように読む", () => {
    const content = {
      type: "tableContent",
      rows: [
        { cells: [[text("試料")], [text("温度 (K)")]] },
        { cells: [[text("A")], [text("300")]] },
      ],
    };
    expect(tableContentToText(content)).toBe("試料 | 温度 (K)\nA | 300");
  });

  it("セルの上付き・下付きは scripts: true で包む（inline と同じ規則）", () => {
    const content = { type: "tableContent", rows: [{ cells: [cell(text("10"), text("5", { superscript: true }))] }] };
    expect(tableContentToText(content)).toBe("105");
    expect(tableContentToText(content, { scripts: true })).toBe("10<sup>5</sup>");
  });

  it("セルの中の改行は空白にし、表の 1 行を 1 行に保つ", () => {
    const content = { type: "tableContent", rows: [{ cells: [cell(text("1 行目\n2 行目")), cell(text("B"))] }] };
    expect(tableContentToText(content)).toBe("1 行目 2 行目 | B");
  });

  it("空のセルは空のまま区切るが、空のセルしか無い行は出さない", () => {
    const content = {
      type: "tableContent",
      rows: [
        { cells: [cell(text("A")), cell(), cell(text("C"))] },
        { cells: [cell(), cell(text(" "))] },
      ],
    };
    expect(tableContentToText(content)).toBe("A |  | C");
  });

  it("表でなければ空文字", () => {
    expect(tableContentToText(undefined)).toBe("");
    expect(tableContentToText({ type: "tableContent" })).toBe("");
  });
});
