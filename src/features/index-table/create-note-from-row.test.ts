// getFirstCellText() のユニットテスト

import { describe, it, expect } from "vitest";
import { getFirstCellText } from "./create-note-from-row";

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
