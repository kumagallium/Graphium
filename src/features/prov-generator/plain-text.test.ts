import { describe, it, expect } from "vitest";
import { blockToPlainText, blocksToPlainText, collectBlockTexts } from "./plain-text";

const text = (t: string, styles: Record<string, unknown> = {}) => ({ type: "text", text: t, styles });
const block = (type: string, content: any, props: Record<string, unknown> = {}, id = "b", children: any[] = []) => ({
  id,
  type,
  props,
  content,
  children,
});

describe("blockToPlainText", () => {
  it.each(["paragraph", "heading", "bulletListItem", "numberedListItem", "quote", "callout", "codeBlock"])(
    "%s は inline content のテキストになる",
    (type) => {
      expect(blockToPlainText(block(type, [text("あい"), text("う")]))).toBe("あいう");
    },
  );

  it("リンクは中身の文字だけ、inlineMath は $…$ で残る", () => {
    const b = block("paragraph", [
      text("式 "),
      { type: "link", href: "https://example.com", content: [text("リンク")] },
      { type: "inlineMath", props: { latex: "x^2" } },
    ]);
    expect(blockToPlainText(b)).toBe("式 リンク$x^2$");
  });

  it("checkListItem は完了状態を [x] / [ ] で前置する", () => {
    expect(blockToPlainText(block("checkListItem", [text("計量")], { checked: true }))).toBe("[x] 計量");
    expect(blockToPlainText(block("checkListItem", [text("撹拌")], { checked: false }))).toBe("[ ] 撹拌");
  });

  it("math は latex", () => {
    expect(blockToPlainText(block("math", undefined, { latex: "E=mc^2" }))).toBe("E=mc^2");
  });

  it("calc は name と source を改行で並べる（name が無ければ source のみ）", () => {
    expect(blockToPlainText(block("calc", undefined, { name: "収率", source: "a = 1\nb = a * 2" }))).toBe("収率\na = 1\nb = a * 2");
    expect(blockToPlainText(block("calc", undefined, { name: "", source: "a = 1" }))).toBe("a = 1");
  });

  it("chart は config の caption。parse できなければ空", () => {
    expect(blockToPlainText(block("chart", undefined, { config: JSON.stringify({ caption: "図1 温度依存" }) }))).toBe("図1 温度依存");
    expect(blockToPlainText(block("chart", undefined, { config: "{broken" }))).toBe("");
    expect(blockToPlainText(block("chart", undefined, { config: "" }))).toBe("");
  });

  it("bookmark は title — description", () => {
    expect(blockToPlainText(block("bookmark", undefined, { title: "題", description: "説明" }))).toBe("題 — 説明");
    expect(blockToPlainText(block("bookmark", undefined, { title: "題", description: "" }))).toBe("題");
  });

  it("dataTable は caption", () => {
    expect(blockToPlainText(block("dataTable", undefined, { caption: "測定データ" }))).toBe("測定データ");
  });

  it("table は行ごとに | 区切り（BlockNote 新旧のセル形式の両方）", () => {
    const b = block("table", {
      type: "tableContent",
      rows: [
        { cells: [[text("A")], { type: "tableCell", content: [text("B")], props: {} }] },
        { cells: [[text("1")], [text("2")]] },
      ],
    });
    expect(blockToPlainText(b)).toBe("A | B\n1 | 2");
  });

  it("メディアは [種類: 名前] キャプション。名前が無ければ URL の末尾", () => {
    expect(blockToPlainText(block("image", undefined, { url: "u", name: "a.png", caption: "全景" }))).toBe("[image: a.png] 全景");
    expect(blockToPlainText(block("video", undefined, { url: "media-server://x/clip%201.mp4?v=1", name: "" }))).toBe("[video: clip 1.mp4]");
    expect(blockToPlainText(block("pdf", undefined, { url: "", name: "" }))).toBe("[pdf]");
    for (const type of ["audio", "file", "pdf"]) {
      expect(blockToPlainText(block(type, undefined, { url: "u", name: "n" }))).toBe(`[${type}: n]`);
    }
  });

  it("未知のブロックは inline content が取れれば読み、取れなければ空", () => {
    expect(blockToPlainText(block("customThing", [text("中身")]))).toBe("中身");
    expect(blockToPlainText(block("meetingTranscript", undefined, { fileId: "f" }))).toBe("");
    expect(blockToPlainText(null)).toBe("");
  });

  it("空のブロックは空文字", () => {
    expect(blockToPlainText(block("paragraph", []))).toBe("");
  });
});

describe("blocksToPlainText / collectBlockTexts", () => {
  const blocks = [
    block("heading", [text("見出し")], { level: 2 }, "h"),
    block("paragraph", [text("親")], {}, "p", [
      block("paragraph", [text("子")], {}, "c"),
      block("paragraph", [], {}, "empty"),
    ]),
    block("heading", [text("末尾")], { level: 1 }, "h1"),
  ];

  it("深さ優先で全ブロックを改行連結し、見出しは level 数だけ # を前置、空行は除く", () => {
    expect(blocksToPlainText(blocks)).toBe("## 見出し\n親\n子\n# 末尾");
  });

  it("collectBlockTexts は blockId 付きで同じ規則", () => {
    expect(collectBlockTexts(blocks)).toEqual([
      { blockId: "h", text: "## 見出し" },
      { blockId: "p", text: "親" },
      { blockId: "c", text: "子" },
      { blockId: "h1", text: "# 末尾" },
    ]);
  });

  it("空配列は空文字", () => {
    expect(blocksToPlainText([])).toBe("");
  });
});

describe("空のチェック項目", () => {
  it("本文が空の checkListItem は空文字（途中の空項目を記録に残さない）", () => {
    expect(blockToPlainText(block("checkListItem", [], { checked: false }))).toBe("");
    expect(blockToPlainText(block("checkListItem", [text("  ")], { checked: true }))).toBe("");
  });
});
