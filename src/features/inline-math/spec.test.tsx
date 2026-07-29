// @vitest-environment jsdom
//
// インライン数式がスキーマに正しく登録され、保存済みノートを読み込んでも
// 落とされないことを確認する。
// （未登録のまま読み込むと BlockNote が inline content を黙って捨てるため、
//  本文から数式だけが消える。実際にこの事故を踏んだので回帰テストとして残す）

import { describe, it, expect } from "vitest";
import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs, defaultStyleSpecs, defaultInlineContentSpecs } from "@blocknote/core";
import { inlineMathSpecs } from "./spec";

function createEditorWithInlineMath(initialContent: any[]) {
  const schema = BlockNoteSchema.create({
    blockSpecs: { ...defaultBlockSpecs } as any,
    inlineContentSpecs: { ...defaultInlineContentSpecs, ...inlineMathSpecs } as any,
    styleSpecs: { ...defaultStyleSpecs } as any,
  });
  return BlockNoteEditor.create({ schema, initialContent } as any) as any;
}

describe("inlineMath のスキーマ登録", () => {
  it("保存済みノートの inlineMath が読み込みで消えない", () => {
    const editor = createEditorWithInlineMath([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "係数は ", styles: {} },
          { type: "inlineMath", props: { latex: "b = -0.126" } },
          { type: "text", text: " である", styles: {} },
        ],
      },
    ]);

    const content = editor.document[0].content;
    const inline = content.find((c: any) => c.type === "inlineMath");
    expect(inline).toBeDefined();
    expect(inline.props.latex).toBe("b = -0.126");
  });
});
