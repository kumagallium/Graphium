// note-text.ts のブロック→Markdown 変換・手順抽出の回帰テスト。

import { describe, it, expect } from "vitest";
import { extractInlineText, blocksToMarkdown, collectSteps, extractOneLiner } from "./note-text";

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

  it("上付き・下付きは既定（AI に渡す本文）で <sup> / <sub> にする（10⁵ を 105 にしない）", () => {
    const content = [
      { type: "text", text: "10", styles: {} },
      { type: "text", text: "5", styles: { superscript: true } },
      { type: "text", text: " Pa の H", styles: {} },
      { type: "text", text: "2", styles: { subscript: true } },
      { type: "text", text: "O", styles: {} },
    ];
    expect(extractInlineText(content)).toBe("10<sup>5</sup> Pa の H<sub>2</sub>O");
  });

  it("{ scripts: false } ではタグを入れない（検索索引・照合キー用）", () => {
    const content = [
      { type: "text", text: "10", styles: {} },
      { type: "text", text: "5", styles: { superscript: true } },
    ];
    expect(extractInlineText(content, { scripts: false })).toBe("105");
  });
});

describe("blocksToMarkdown", () => {
  it("数式ブロックを $$ … $$ にする（式は props.latex にあり content を持たない）", () => {
    const blocks = [
      { type: "paragraph", content: text("エネルギーは") },
      { type: "math", props: { latex: "E = mc^2" } },
    ];
    expect(blocksToMarkdown(blocks)).toBe("エネルギーは\n\n$$ E = mc^2 $$");
  });

  it("入れ子のリストと表のセルにも上付き・下付きの出し分けが届く", () => {
    const sup = [
      { type: "text", text: "10", styles: {} },
      { type: "text", text: "-3", styles: { superscript: true } },
      { type: "text", text: " M", styles: {} },
    ];
    const blocks = [
      {
        type: "bulletListItem",
        content: text("濃度"),
        children: [{ type: "bulletListItem", content: sup }],
      },
      {
        type: "table",
        content: { type: "tableContent", rows: [{ cells: [text("条件")] }, { cells: [{ type: "tableCell", content: sup }] }] },
      },
    ];
    expect(blocksToMarkdown(blocks)).toBe(
      "- 濃度\n\n  - 10<sup>-3</sup> M\n\n| 条件 |\n| --- |\n| 10<sup>-3</sup> M |",
    );
    expect(blocksToMarkdown(blocks, 0, { scripts: false })).toBe(
      "- 濃度\n\n  - 10-3 M\n\n| 条件 |\n| --- |\n| 10-3 M |",
    );
  });

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

  it("手順名と中身の上付き・下付き・数式を保つ（get_note_steps は AI に渡す本文）", () => {
    const doc = {
      pages: [
        {
          blocks: [
            {
              type: "step",
              id: "step-1",
              content: [
                { type: "text", text: "CO", styles: {} },
                { type: "text", text: "2", styles: { subscript: true } },
                { type: "text", text: " を流す", styles: {} },
              ],
              children: [{ id: "c1", type: "math", props: { latex: "Q = 10\\,\\mathrm{sccm}" } }],
            },
          ],
        },
      ],
    };
    const [step] = collectSteps(doc);
    expect(step.title).toBe("CO<sub>2</sub> を流す");
    expect(step.body).toBe("$$ Q = 10\\,\\mathrm{sccm} $$");
  });

  it("step が無ければ空配列を返す", () => {
    const doc = { pages: [{ blocks: [{ type: "paragraph", content: text("本文") }] }] };
    expect(collectSteps(doc)).toEqual([]);
  });
});

describe("extractOneLiner", () => {
  it("「定義」見出し直後の段落の先頭文を返す", () => {
    const doc = {
      pages: [
        {
          blocks: [
            { type: "heading", props: { level: 2 }, content: text("定義") },
            { type: "paragraph", content: text("これが定義文です。補足はここから。") },
            { type: "heading", props: { level: 2 }, content: text("背景") },
            { type: "paragraph", content: text("背景の話") },
          ],
        },
      ],
    };
    expect(extractOneLiner(doc)).toBe("これが定義文です。");
  });

  it("定義節が無ければ本文最初の非空段落の先頭文を使う", () => {
    const doc = {
      pages: [
        {
          blocks: [
            { type: "heading", props: { level: 2 }, content: text("概要") },
            { type: "paragraph", content: text("最初の段落。続き。") },
          ],
        },
      ],
    };
    expect(extractOneLiner(doc)).toBe("最初の段落。");
  });

  it("columnList / column を透過する", () => {
    const doc = {
      pages: [
        {
          blocks: [
            {
              type: "columnList",
              children: [
                {
                  type: "column",
                  children: [{ type: "paragraph", content: text("カラム内の本文です。") }],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(extractOneLiner(doc)).toBe("カラム内の本文です。");
  });

  it("本文が無ければ空文字を返す", () => {
    expect(extractOneLiner({ pages: [] })).toBe("");
    expect(extractOneLiner({ pages: [{ blocks: [] }] })).toBe("");
  });
});
