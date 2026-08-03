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

import { describe, it, expect, vi } from "vitest";
import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";

// registry（sanitizeBlocksForLoad）は pdf-viewer 経由で react-pdf を読むため、
// 描画まわりだけモックする（registry.test.ts と同じ理由）
vi.mock("react-pdf", () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}));
vi.mock("../../lib/pdfjs-config", () => ({}));

import { columnListBlock, columnBlock, columnsSlashItem } from "./index";
import { sanitizeBlocksForLoad } from "../registry";

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

  it("sanitize の構造修復を通した不正構造で BlockNoteEditor.create が throw しない", () => {
    // 「カラムの唯一の子が未知型」という version skew で生まれる JSON。
    // 修復なしだと column が空になり PM の content 制約（blockContainer+）
    // 違反で create が throw → メインエディタにはエラーバウンダリが無く画面全損
    const pathological = [
      {
        id: "cl",
        type: "columnList",
        children: [
          { id: "c1", type: "column", children: [{ id: "u", type: "futureBlock", children: [] }] },
          { id: "c2", type: "column", children: [para("生き残る本文")] },
        ],
      },
    ];
    const repaired = sanitizeBlocksForLoad(pathological);
    // 修復済み構造でエディタが作れること（throw しない）が本題
    const ed = makeEditor(repaired);
    const texts = JSON.stringify(ed.document);
    expect(texts).toContain("生き残る本文");
    // 単一カラム化した columnList は解消されている
    expect((ed.document as any[]).some((b) => b.type === "columnList")).toBe(false);
  });

  it("カラム内から /カラム を実行すると最外の columnList の後ろに挿入される", () => {
    // column の content は blockContainer+ で columnList を受け入れないため、
    // ガード無しだとカラム内ブロック reference の挿入は TransformError になる
    const ed = makeEditor([twoColumns, para("後続")]);
    const list = (ed.document as any[]).find((b) => b.type === "columnList");
    const innerPara = list.children[0].children[0];
    ed.setTextCursorPosition(innerPara, "start");

    expect(() => columnsSlashItem.onItemClick(ed)).not.toThrow();

    const doc = ed.document as any[];
    const lists = doc.filter((b) => b.type === "columnList");
    // 2 つ目の columnList がトップレベル（元の columnList の直後）に入る
    expect(lists).toHaveLength(2);
    expect(doc.findIndex((b) => b.id === lists[1].id)).toBe(
      doc.findIndex((b) => b.id === lists[0].id) + 1,
    );
    // 元のカラムの中身は無傷
    expect(JSON.stringify(lists[0])).toContain("左カラムの本文");
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
