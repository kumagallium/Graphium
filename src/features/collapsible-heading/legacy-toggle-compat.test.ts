// @vitest-environment jsdom
//
// 既存ノートに残る `isToggleable: true`（旧・Notion 式トグル見出し）が、
// allowToggleHeadings を切ったスキーマでも壊れずに読めるかの検証。
//
// 折りたたみを全見出しに統合するにあたって BlockNote 標準のトグル UI を止めるが、
// prop がスキーマから消えることで既存ノートが開けなくなると致命的なので、
// round-trip をここで固定する。

import { describe, it, expect } from "vitest";
import {
  BlockNoteEditor,
  BlockNoteSchema,
  defaultBlockSpecs,
  createHeadingBlockSpec,
} from "@blocknote/core";

function makeEditor(allowToggleHeadings: boolean, initialContent?: any[]) {
  const schema = BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      heading: createHeadingBlockSpec({ allowToggleHeadings }),
    } as any,
  });
  return BlockNoteEditor.create({
    schema,
    initialContent: initialContent?.length ? initialContent : undefined,
  } as any);
}

const legacyToggleHeading = {
  type: "heading",
  props: { level: 2, isToggleable: true },
  content: [{ type: "text", text: "実験条件", styles: {} }],
  children: [
    { type: "paragraph", content: [{ type: "text", text: "温度は 300 K", styles: {} }] },
  ],
};

describe("旧トグル見出しの互換", () => {
  it("allowToggleHeadings:true では isToggleable が prop に残る（現状確認）", () => {
    const ed = makeEditor(true, [legacyToggleHeading]);
    const doc = ed.document;
    expect(doc[0].type).toBe("heading");
    expect((doc[0].props as any).isToggleable).toBe(true);
    expect(doc[0].children?.length).toBe(1);
  });

  it("allowToggleHeadings:false でも throw せず、本文と children が保たれる", () => {
    const ed = makeEditor(false, [legacyToggleHeading]);
    const doc = ed.document;
    expect(doc[0].type).toBe("heading");
    expect((doc[0].props as any).level).toBe(2);
    expect((doc[0].content as any)[0].text).toBe("実験条件");
    // 中身（旧トグルの children）が消えていないこと ← ここが一番大事
    expect(doc[0].children?.length).toBe(1);
    expect((doc[0].children?.[0].content as any)[0].text).toBe("温度は 300 K");
  });

  it("allowToggleHeadings:false のスキーマに isToggleable prop は無い", () => {
    const ed = makeEditor(false);
    expect(Object.keys(ed.schema.blockSchema.heading.propSchema)).not.toContain("isToggleable");
  });
});
