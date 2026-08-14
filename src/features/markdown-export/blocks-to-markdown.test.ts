// @vitest-environment jsdom
//
// blocks-to-markdown.ts の統合テスト（実際の BlockNote エディタを通す）
//
// 純ロジックのテスト（sanitize-blocks.test.ts）とは別に、フルスキーマの
// エディタ経由でも同じ Markdown になることを確認する。ここが崩れると、
// カスタムブロックは画面の DOM がそのまま Markdown 化され、ボタンのラベルや
// 読み込み中表示（"Settings" / "Loading chart…"）、Context を辿れない場所で
// 解決に失敗した i18n キー（"citation.type.paper"）が本文に混ざる。
// 数式に至っては LaTeX ではなく KaTeX の描画結果（"E=mc2"）になり内容が壊れる。

import { describe, it, expect, vi } from "vitest";

// registry は pdf-viewer 経由で react-pdf（canvas/DOMMatrix 前提）を読み込むため
// 描画まわりだけモックする（registry.test.ts と同じ理由）
vi.mock("react-pdf", () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}));
vi.mock("../../lib/pdfjs-config", () => ({}));

import {
  BlockNoteEditor,
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultStyleSpecs,
  defaultInlineContentSpecs,
} from "@blocknote/core";
import { customBlockEntries } from "../../blocks/registry";
import { inlineMathSpecs } from "../inline-math/spec";
import { inlineLabelStyleSpecs } from "../inline-label/styles";
import { blocksToMarkdown } from "./blocks-to-markdown";

/** 本番のエディタ（base/editor.tsx）と同じスキーマを組む */
function createFullEditor() {
  const customSpecs = Object.fromEntries(
    customBlockEntries.map((b) => [b.type, typeof b.spec === "function" ? (b.spec as any)() : b.spec]),
  );
  const schema = BlockNoteSchema.create({
    blockSpecs: { ...defaultBlockSpecs, ...customSpecs } as any,
    inlineContentSpecs: { ...defaultInlineContentSpecs, ...inlineMathSpecs } as any,
    styleSpecs: { ...defaultStyleSpecs, ...inlineLabelStyleSpecs } as any,
  });
  return BlockNoteEditor.create({ schema }) as any;
}

const md = (blocks: any[]) => blocksToMarkdown(createFullEditor(), blocks);

describe("blocksToMarkdown（フルスキーマのエディタ経由）", () => {
  it("数式は描画結果ではなく LaTeX ソースで残る", async () => {
    const out = await md([{ type: "math", props: { latex: "E = mc^2" }, children: [] }]);
    expect(out).toContain("$$ E = mc^2 $$");
    // KaTeX の描画結果（"E=mc2"）が漏れていないこと
    expect(out).not.toContain("E=mc2");
  });

  it("チャートはキャプションと系列が読める 1 行になり、UI 文字列を漏らさない", async () => {
    const config = {
      chartType: "line",
      caption: "図1 温度依存性",
      series: [{ sourceBlockId: "t1", xColumn: "Temperature", yColumn: "Resistivity" }],
    };
    const out = await md([
      { type: "chart", props: { config: JSON.stringify(config), sourceBlockId: "" }, children: [] },
    ]);
    expect(out).toContain("図1 温度依存性");
    expect(out).toContain("Resistivity vs Temperature");
    expect(out).not.toContain("Settings");
    expect(out).not.toContain("Loading chart");
  });

  it("計算ブロックは式と結果が残る", async () => {
    const results = [{ kind: "value", text: "2 kg" }];
    const out = await md([
      { type: "calc", props: { source: "a = 2 kg", results: JSON.stringify(results) }, children: [] },
    ]);
    expect(out).toContain("a = 2 kg");
    expect(out).toContain("// 2 kg");
  });

  it("PDF ブロックはファイル名が残る", async () => {
    const out = await md([
      { type: "pdf", props: { url: "local-media://abc", name: "paper.pdf" }, children: [] },
    ]);
    expect(out).toContain("paper.pdf");
  });

  it("引用カードは書誌情報になり、i18n キーを漏らさない", async () => {
    const out = await md([
      {
        type: "sharedCitation",
        props: { sharedId: "s1", cachedTitle: "共有資料", entryType: "paper", cachedAuthor: "著者" },
        children: [],
      },
    ]);
    expect(out).toContain("共有資料");
    expect(out).toContain("shared://s1");
    // 解決前の i18n キーや検証中の状態表示が本文に混ざらないこと
    expect(out).not.toContain("citation.type.");
    expect(out).not.toContain("Checking");
  });

  it("ブックマークはリンク 1 行になり、favicon の画像は混ざらない", async () => {
    const out = await md([
      {
        type: "bookmark",
        props: { url: "https://example.com", title: "Example", domain: "example.com" },
        children: [],
      },
    ]);
    expect(out).toContain("[Example](https://example.com)");
    expect(out).not.toContain("favicons");
  });

  it("step はタイトルが H2、中身がその下に出る", async () => {
    const out = await md([
      {
        type: "step",
        props: {},
        content: [{ type: "text", text: "試料を秤量する", styles: {} }],
        children: [
          { type: "paragraph", content: [{ type: "text", text: "0.5 g", styles: {} }], children: [] },
        ],
      },
    ]);
    expect(out).toContain("## 試料を秤量する");
    expect(out).toContain("0.5 g");
  });

  it("マルチカラムは中身がカラム順に並ぶ", async () => {
    const out = await md([
      {
        type: "columnList",
        children: [
          {
            type: "column",
            props: { width: 1 },
            children: [{ type: "paragraph", content: [{ type: "text", text: "左", styles: {} }], children: [] }],
          },
          {
            type: "column",
            props: { width: 1 },
            children: [{ type: "paragraph", content: [{ type: "text", text: "右", styles: {} }], children: [] }],
          },
        ],
      },
    ]);
    expect(out.indexOf("左")).toBeGreaterThanOrEqual(0);
    expect(out.indexOf("右")).toBeGreaterThan(out.indexOf("左"));
  });

  it("内部リンク（@メンション）は [[タイトル]] になる", async () => {
    const out = await md([
      {
        type: "paragraph",
        props: {},
        content: [{ type: "text", text: "@別のノート", styles: { textColor: "blue" } }],
        children: [],
      },
    ]);
    expect(out).toContain("[[別のノート]]");
  });
});
