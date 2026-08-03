// @vitest-environment jsdom
//
// マルチカラム（columnList / column）— モデル層の round-trip 検証
//
// 「自前の columnList / column ノードが BlockNote ^0.47 のカラム下地に乗るか」を
// ヘッドレス BlockNoteEditor（step/spike.test.ts と同じ create パターン）で
// 決定論的に確認する。
//   - columnList > column×2 > ブロック の構造が Block JSON として round-trip する
//   - column の width prop（flex-grow 比率）が保存・復元される
//   - insertBlocks でネスト構造ごと挿入できる（スラッシュメニューの経路）
//   - Markdown 書き出し（外部 HTML 経由）でカラム中身が失われない
// 視覚・リサイズドラッグは実機（Playwright / dev）で別途確認する。

import { describe, it, expect } from "vitest";
import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { columnListBlock, columnBlock } from "./index";

function makeEditor(initialContent?: any[]) {
  const schema = BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      columnList: columnListBlock.spec,
      column: columnBlock.spec,
    } as any,
  });
  return BlockNoteEditor.create({
    schema,
    initialContent: initialContent?.length ? initialContent : undefined,
  } as any);
}

const para = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text, styles: {} }],
});

const twoColumns = {
  type: "columnList",
  children: [
    {
      type: "column",
      children: [para("左カラムの本文"), para("左カラム 2 行目")],
    },
    {
      type: "column",
      props: { width: 2 },
      children: [para("右カラムの本文")],
    },
  ],
};

describe("multi-column — model round-trip", () => {
  it("columnList > column×2 > 段落 が round-trip する", () => {
    const ed = makeEditor([para("前置き"), twoColumns]);
    const doc = ed.document as any[];
    const list = doc.find((b) => b.type === "columnList");
    expect(list).toBeTruthy();
    expect(list.children.map((c: any) => c.type)).toEqual(["column", "column"]);
    expect(list.children[0].children.map((c: any) => c.content?.[0]?.text)).toEqual([
      "左カラムの本文",
      "左カラム 2 行目",
    ]);
    expect(list.children[1].children[0].content?.[0]?.text).toBe("右カラムの本文");
  });

  it("column の width prop が保持される（既定 1 / 指定値）", () => {
    const ed = makeEditor([twoColumns]);
    const list = (ed.document as any[]).find((b) => b.type === "columnList");
    expect(list.children[0].props.width).toBe(1); // 既定値
    expect(list.children[1].props.width).toBe(2); // 指定値
  });

  it("不透明 JSON 保存（StorageProvider 相当）を挟んでも構造と width が保たれる", () => {
    const ed1 = makeEditor([twoColumns]);
    const roundTripped = JSON.parse(JSON.stringify(ed1.document));
    const ed2 = makeEditor(roundTripped);
    const list = (ed2.document as any[]).find((b) => b.type === "columnList");
    expect(list.children.map((c: any) => c.type)).toEqual(["column", "column"]);
    expect(list.children[1].props.width).toBe(2);
    expect(list.children[0].children[0].content?.[0]?.text).toBe("左カラムの本文");
  });

  it("insertBlocks でネスト構造ごと挿入できる（スラッシュメニューの経路）", () => {
    const ed = makeEditor([para("既存ブロック")]);
    const target = (ed.document as any[])[0];
    ed.insertBlocks(
      [
        {
          type: "columnList",
          children: [
            { type: "column", children: [{ type: "paragraph" }] },
            { type: "column", children: [{ type: "paragraph" }] },
          ],
        } as any,
      ],
      target,
      "after",
    );
    const list = (ed.document as any[]).find((b) => b.type === "columnList");
    expect(list).toBeTruthy();
    expect(list.children.length).toBe(2);
    // UniqueID が id を払い出している（columnList / column が types に入っている証拠）
    expect(typeof list.id).toBe("string");
    expect(list.id.length).toBeGreaterThan(0);
    expect(typeof list.children[0].id).toBe("string");
  });

  it("Markdown 書き出し（外部 HTML 経由）でカラム中身が失われない", async () => {
    // toExternalHTML が contentDOM を返さない実装だと、core の
    // serializeBlocksExternalHTML がカラム中身を黙って捨てる（無音全損）。
    // ライブエディタ系 4 経路（単一 export / ページ全体チャット / 選択 AI /
    // DragHandle AI）が全てこの経路を通るため、ここで回帰を検出する。
    const ed = makeEditor([twoColumns, para("後続の本文")]);
    const md = await ed.blocksToMarkdownLossy(ed.document as any);
    expect(md).toContain("左カラムの本文");
    expect(md).toContain("左カラム 2 行目");
    expect(md).toContain("右カラムの本文");
    expect(md).toContain("後続の本文");
  });
});
