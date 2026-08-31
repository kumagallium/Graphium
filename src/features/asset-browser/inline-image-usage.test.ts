// インライン画像の usedIn 走査（media-index v7）
import { describe, expect, it } from "vitest";
import { collectInlineImageFileIdsFromBlocks } from "./media-index";

const img = (fileId: string) => ({ type: "inlineImage", props: { fileId, name: "x.png" } });
const text = (t: string) => ({ type: "text", text: t, styles: {} });

describe("collectInlineImageFileIdsFromBlocks", () => {
  it("段落・テーブルセル・子ブロックのインライン画像を集める", () => {
    const blocks = [
      { id: "p1", type: "paragraph", content: [text("図: "), img("f-para")] },
      {
        id: "t1",
        type: "table",
        content: {
          type: "tableContent",
          rows: [
            { cells: [[text("試料")], [text("画像")]] },
            { cells: [[text("A-1")], [img("f-cell"), text(" 補足")]] },
            // 新形式（tableCell オブジェクト）のセル
            { cells: [{ type: "tableCell", content: [img("f-tablecell")] }, [text("")]] },
          ],
        },
      },
      {
        id: "s1",
        type: "step",
        content: [text("焼成")],
        children: [{ id: "c1", type: "paragraph", content: [img("f-child")] }],
      },
    ];
    const ids = collectInlineImageFileIdsFromBlocks(blocks as any);
    expect([...ids].sort()).toEqual(["f-cell", "f-child", "f-para", "f-tablecell"]);
  });

  it("fileId の無い・壊れた要素は無視する", () => {
    const blocks = [
      { id: "p1", type: "paragraph", content: [{ type: "inlineImage", props: {} }, null, "str"] },
    ];
    expect(collectInlineImageFileIdsFromBlocks(blocks as any).size).toBe(0);
    expect(collectInlineImageFileIdsFromBlocks([] as any).size).toBe(0);
  });
});
