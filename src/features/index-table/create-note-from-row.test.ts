// getFirstCellText() のユニットテスト

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createNoteFromRow, getFirstCellText } from "./create-note-from-row";

// createNoteFromRow が使う保存先と設定を差し替える
const createFile = vi.fn(async (_title: string, _doc: unknown) => "new-id");
let newNotesOnA4 = false;
vi.mock("../../lib/storage/registry", () => ({
  getActiveProvider: () => ({ createFile }),
}));
vi.mock("../settings/store", () => ({
  isNewNotesOnA4: () => newNotesOnA4,
}));

// テスト用ヘルパー: テーブルブロックを構築する
function makeTableBlock(rows: any[]) {
  return {
    type: "table",
    content: { rows },
  };
}

describe("getFirstCellText", () => {
  // 配列形式の InlineContent から最初のセルのテキストを返す
  it("配列形式のセルからテキストを返す", () => {
    const block = makeTableBlock([
      {
        cells: [
          [{ type: "text", text: "Sample-001" }],
          [{ type: "text", text: "100mg" }],
        ],
      },
    ]);
    expect(getFirstCellText(block, 0)).toBe("Sample-001");
  });

  it("配列形式のセルで複数インラインコンテンツを結合する", () => {
    const block = makeTableBlock([
      {
        cells: [
          [
            { type: "text", text: "Part " },
            { type: "text", text: "A" },
          ],
        ],
      },
    ]);
    expect(getFirstCellText(block, 0)).toBe("Part A");
  });

  // オブジェクト形式（.text プロパティ）のセルからテキストを返す
  it("オブジェクト形式のセル（.text）からテキストを返す", () => {
    const block = makeTableBlock([
      {
        cells: [{ text: "Object Cell" }],
      },
    ]);
    expect(getFirstCellText(block, 0)).toBe("Object Cell");
  });

  // オブジェクト形式（.content 配列）のセルからテキストを返す
  it("オブジェクト形式のセル（.content 配列）からテキストを返す", () => {
    const block = makeTableBlock([
      {
        cells: [
          {
            content: [
              { type: "text", text: "Nested " },
              { type: "text", text: "Content" },
            ],
          },
        ],
      },
    ]);
    expect(getFirstCellText(block, 0)).toBe("Nested Content");
  });

  // 存在しない行インデックスでは空文字を返す
  it("存在しない行インデックスで空文字を返す", () => {
    const block = makeTableBlock([
      { cells: [[{ type: "text", text: "唯一の行" }]] },
    ]);
    expect(getFirstCellText(block, 5)).toBe("");
  });

  // rows がない場合は空文字を返す
  it("rows がない場合は空文字を返す", () => {
    const block = { type: "table", content: {} };
    expect(getFirstCellText(block, 0)).toBe("");
  });

  // content 自体がないブロックでは空文字を返す
  it("content がないブロックで空文字を返す", () => {
    const block = { type: "table" };
    expect(getFirstCellText(block, 0)).toBe("");
  });

  // 空のセル（空配列）では空文字を返す
  it("空のセル配列で空文字を返す", () => {
    const block = makeTableBlock([{ cells: [[]] }]);
    expect(getFirstCellText(block, 0)).toBe("");
  });

  // ホワイトスペースをトリムする
  it("テキストのホワイトスペースをトリムする", () => {
    const block = makeTableBlock([
      {
        cells: [[{ type: "text", text: "  trimmed  " }]],
      },
    ]);
    expect(getFirstCellText(block, 0)).toBe("trimmed");
  });

  // 文字列形式のセルをサポートする
  it("文字列形式のセルからテキストを返す", () => {
    const block = makeTableBlock([
      { cells: ["  plain string  "] },
    ]);
    expect(getFirstCellText(block, 0)).toBe("plain string");
  });

  // 2行目のデータを正しく取得する
  it("指定した行インデックスのセルを返す", () => {
    const block = makeTableBlock([
      { cells: [[{ type: "text", text: "Row 0" }]] },
      { cells: [[{ type: "text", text: "Row 1" }]] },
      { cells: [[{ type: "text", text: "Row 2" }]] },
    ]);
    expect(getFirstCellText(block, 1)).toBe("Row 1");
    expect(getFirstCellText(block, 2)).toBe("Row 2");
  });
});

describe("createNoteFromRow の本文の幅（自分で始めるノートとして設定に従う）", () => {
  const editor = {
    getBlock: () => ({
      type: "table",
      content: { rows: [{ cells: [[{ type: "text", text: "Sample-001" }]] }] },
    }),
  };
  const store = { setNoteLink: vi.fn() };

  beforeEach(() => {
    createFile.mockClear();
  });

  it("設定が ON なら paperSize: a4 を書く", async () => {
    newNotesOnA4 = true;
    await createNoteFromRow(editor, "t1", 0, [], store);
    const doc = createFile.mock.calls[0][1] as { paperSize?: string; fullWidth?: boolean };
    expect(doc.paperSize).toBe("a4");
    expect(doc.fullWidth).toBeUndefined();
  });

  it("設定が OFF なら幅の項目を書かない（派生元がある場合も設定だけを見る）", async () => {
    newNotesOnA4 = false;
    await createNoteFromRow(editor, "t1", 0, [], store, undefined, "parent");
    const doc = createFile.mock.calls[0][1] as Record<string, unknown>;
    expect("paperSize" in doc).toBe(false);
    expect("fullWidth" in doc).toBe(false);
  });
});
