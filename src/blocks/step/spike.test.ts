// Step コンテナブロック 実現性スパイク（§7）— モデル層の round-trip 検証
//
// 「children を持つカスタムブロックが BlockNote ^0.47 で成立するか」を
// ヘッドレス BlockNoteEditor（markdown-export と同じ create パターン）で決定論的に確認する。
//   - 条件1: 段落・テーブル・画像・コードを step の子として保持できる
//   - 条件4: save→load（blocks: any[] を JSON でシリアライズ）で children が round-trip する
// 視覚・ドラッグ（条件2/3/5）は Storybook + Playwright で別途確認する。

import { describe, it, expect } from "vitest";
import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { StepBlock } from "./view";

// SandboxEditor と同じ要領で step を混ぜたスキーマを作る（styleSpecs は既定でよい）
function makeEditor(initialContent: any[]) {
  const schema = BlockNoteSchema.create({
    blockSpecs: { ...defaultBlockSpecs, step: StepBlock() } as any,
  });
  return BlockNoteEditor.create({ schema, initialContent } as any);
}

const para = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text, styles: {} }],
});

// BlockNote 0.47 はテーブルセルを {type:"tableCell", content:[...]} に正規化しうるため、
// 配列セル／セルオブジェクトの両方からテキストを取り出す
function cellText(cell: any): string {
  const inline = Array.isArray(cell) ? cell : cell?.content;
  return inline?.[0]?.text ?? "";
}

const table = {
  type: "table",
  content: {
    type: "tableContent",
    rows: [
      {
        cells: [
          [{ type: "text", text: "試薬", styles: {} }],
          [{ type: "text", text: "量", styles: {} }],
        ],
      },
      {
        cells: [
          [{ type: "text", text: "NaCl", styles: {} }],
          [{ type: "text", text: "5 g", styles: {} }],
        ],
      },
    ],
  },
};

const image = {
  type: "image",
  props: { url: "https://example.com/reaction.png", previewWidth: 240 },
};

const code = {
  type: "codeBlock",
  props: { language: "python" },
  content: [{ type: "text", text: "print('step body')", styles: {} }],
};

describe("step container spike — model round-trip", () => {
  it("サニティ: トップレベルの table/image/code は round-trip する", () => {
    const ed = makeEditor([para("x"), table, image, code]);
    const types = (ed.document as any[]).map((b) => b.type);
    expect(types).toEqual(
      expect.arrayContaining(["paragraph", "table", "image", "codeBlock"]),
    );
  });

  it("step が 段落/テーブル/画像/コード を子として保持し round-trip する", () => {
    const step = {
      type: "step",
      content: [{ type: "text", text: "反応 A を実施する", styles: {} }],
      children: [para("試薬を混合し 60°C で撹拌した。"), table, image, code],
    };
    const ed = makeEditor([step]);
    const doc = ed.document as any[];
    const s = doc.find((b) => b.type === "step");
    expect(s).toBeTruthy();
    // タイトルは content に載る（§4.1）
    expect(s.content?.[0]?.text).toBe("反応 A を実施する");
    // 4 種の子が順序どおり保持される
    expect(s.children.map((c: any) => c.type)).toEqual([
      "paragraph",
      "table",
      "image",
      "codeBlock",
    ]);
    // 入れ子テーブルの中身が保たれる
    const t = s.children.find((c: any) => c.type === "table");
    expect(t.content.rows.length).toBe(2);
    expect(cellText(t.content.rows[1].cells[0])).toBe("NaCl");
    // 画像 URL が保たれる
    const img = s.children.find((c: any) => c.type === "image");
    expect(img.props.url).toBe("https://example.com/reaction.png");
  });

  it("不透明 JSON 保存（StorageProvider 相当）を挟んでも children が保たれる", () => {
    const step = {
      type: "step",
      content: [{ type: "text", text: "反応 A", styles: {} }],
      children: [para("本文"), table, code],
    };
    const ed1 = makeEditor([step]);
    // saveFile は doc を不透明に JSON 保存する → それを模す
    const roundTripped = JSON.parse(JSON.stringify(ed1.document));
    const ed2 = makeEditor(roundTripped);
    const s = (ed2.document as any[]).find((b) => b.type === "step");
    expect(s.children.map((c: any) => c.type)).toEqual([
      "paragraph",
      "table",
      "codeBlock",
    ]);
    expect(s.content?.[0]?.text).toBe("反応 A");
  });
});
