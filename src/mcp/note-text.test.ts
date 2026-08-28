// note-text.ts のブロック→Markdown 変換・手順抽出の回帰テスト。

import { describe, it, expect } from "vitest";
import { extractInlineText, blocksToMarkdown, collectSteps } from "./note-text";

/** テキストのみの inline content を組み立てる小ヘルパー */
function text(t: string) {
  return [{ type: "text", text: t, styles: {} }];
}

describe("extractInlineText", () => {
  it("text の inline content からプレーンテキストを取り出す", () => {
    expect(extractInlineText(text("hello"))).toBe("hello");
  });

  it("inlineMath を $ で囲んだ LaTeX にする", () => {
    const content = [{ type: "inlineMath", props: { latex: "x^2" } }];
    expect(extractInlineText(content)).toBe("$x^2$");
  });

  it("入れ子の content も再帰的に拾う", () => {
    const content = [
      { type: "link", content: [{ type: "text", text: "nested" }] },
    ];
    expect(extractInlineText(content)).toBe("nested");
  });

  it("配列でなければ空文字を返す", () => {
    expect(extractInlineText(undefined)).toBe("");
    expect(extractInlineText(null)).toBe("");
  });
});

describe("blocksToMarkdown", () => {
  it("heading を # に変換する", () => {
    const blocks = [{ type: "heading", props: { level: 2 }, content: text("見出し") }];
    expect(blocksToMarkdown(blocks)).toBe("## 見出し");
  });

  it("bulletListItem を - に変換する", () => {
    const blocks = [{ type: "bulletListItem", content: text("項目1") }];
    expect(blocksToMarkdown(blocks)).toBe("- 項目1");
  });

  it("codeBlock をコードフェンスに変換する", () => {
    const blocks = [
      { type: "codeBlock", props: { language: "ts" }, content: text("const x = 1;") },
    ];
    expect(blocksToMarkdown(blocks)).toBe("```ts\nconst x = 1;\n```");
  });

  it("table を Markdown テーブルに変換する", () => {
    const blocks = [
      {
        type: "table",
        content: {
          rows: [
            { cells: [text("a"), text("b")] },
            { cells: [text("1"), text("2")] },
          ],
        },
      },
    ];
    const md = blocksToMarkdown(blocks);
    expect(md).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |");
  });

  it("columnList / column を透過して中身だけ出す", () => {
    const blocks = [
      {
        type: "columnList",
        children: [
          {
            type: "column",
            children: [{ type: "paragraph", content: text("カラム中身") }],
          },
        ],
      },
    ];
    expect(blocksToMarkdown(blocks)).toBe("カラム中身");
  });
});

describe("collectSteps", () => {
  it("step を文書順に番号付きで返し、childBlockIds に子ブロック ID が入る", () => {
    const doc = {
      pages: [
        {
          blocks: [
            {
              type: "step",
              id: "step-1",
              content: text("最初の工程"),
              children: [
                { id: "child-1", type: "paragraph", content: text("説明1") },
                { id: "child-2", type: "paragraph", content: text("説明2") },
              ],
            },
            {
              type: "step",
              id: "step-2",
              content: text("次の工程"),
              children: [{ id: "child-3", type: "paragraph", content: text("説明3") }],
            },
          ],
        },
      ],
    };

    const steps = collectSteps(doc);
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({
      blockId: "step-1",
      title: "最初の工程",
      order: 1,
      childBlockIds: ["child-1", "child-2"],
    });
    expect(steps[1]).toMatchObject({
      blockId: "step-2",
      title: "次の工程",
      order: 2,
      childBlockIds: ["child-3"],
    });
  });

  it("step が無ければ空配列を返す", () => {
    const doc = { pages: [{ blocks: [{ type: "paragraph", content: text("本文") }] }] };
    expect(collectSteps(doc)).toEqual([]);
  });
});
