// extractBlockTitle() のユニットテスト

import { describe, it, expect } from "vitest";
import { extractBlockTitle } from "./SourceDocPanel";

describe("extractBlockTitle", () => {
  // テキスト系ブロック（paragraph / heading）のテキスト内容を返す
  it("テキスト系ブロックのテキスト内容を返す", () => {
    const block = {
      type: "paragraph",
      content: [
        { type: "text", text: "Hello " },
        { type: "text", text: "World" },
      ],
    };
    expect(extractBlockTitle(block)).toBe("Hello World");
  });

  it("heading ブロックのテキスト内容を返す", () => {
    const block = {
      type: "heading",
      props: { level: 2 },
      content: [{ type: "text", text: "見出しテスト" }],
    };
    expect(extractBlockTitle(block)).toBe("見出しテスト");
  });

  // 50文字を超えるテキストは "…" で切り詰める
  it("50文字を超えるテキストを切り詰める", () => {
    const longText = "a".repeat(60);
    const block = {
      type: "paragraph",
      content: [{ type: "text", text: longText }],
    };
    const result = extractBlockTitle(block);
    expect(result).toBe("a".repeat(50) + "…");
    expect(result.length).toBe(51); // 50 + "…"
  });

  it("ちょうど50文字のテキストは切り詰めない", () => {
    const text50 = "b".repeat(50);
    const block = {
      type: "paragraph",
      content: [{ type: "text", text: text50 }],
    };
    expect(extractBlockTitle(block)).toBe(text50);
  });

  // 画像ブロック: name プロパティがあればその名前を返す
  it("画像ブロックの name プロパティを返す", () => {
    const block = {
      type: "image",
      props: { name: "photo.png", url: "https://example.com/photo.png" },
    };
    expect(extractBlockTitle(block)).toBe("photo.png");
  });

  // 画像ブロック: name がなく URL があれば、パスからファイル名をデコードして返す
  it("画像ブロックの URL からデコード済みファイル名を返す", () => {
    const block = {
      type: "image",
      props: { url: "https://example.com/images/%E7%94%BB%E5%83%8F.png" },
    };
    expect(extractBlockTitle(block)).toBe("画像.png");
  });

  it("画像ブロックの URL からファイル名を返す（エンコードなし）", () => {
    const block = {
      type: "image",
      props: { url: "https://cdn.example.com/uploads/diagram.svg" },
    };
    expect(extractBlockTitle(block)).toBe("diagram.svg");
  });

  // テーブルブロック: 最初のセルのテキストを返す
  it("テーブルブロックの最初のセルテキストを返す", () => {
    const block = {
      type: "table",
      content: {
        rows: [
          {
            cells: [
              [{ type: "text", text: "Sample ID" }],
              [{ type: "text", text: "Value" }],
            ],
          },
        ],
      },
    };
    expect(extractBlockTitle(block)).toBe("Sample ID");
  });

  // null / undefined ブロックは空文字を返す
  it("null ブロックで空文字を返す", () => {
    expect(extractBlockTitle(null)).toBe("");
  });

  it("undefined ブロックで空文字を返す", () => {
    expect(extractBlockTitle(undefined)).toBe("");
  });

  // content が空配列のブロックでも空文字を返す
  it("content が空のブロックで空文字を返す", () => {
    const block = { type: "paragraph", content: [] };
    expect(extractBlockTitle(block)).toBe("");
  });

  // props も content もないブロックで空文字を返す
  it("props も content もないブロックで空文字を返す", () => {
    const block = { type: "unknown" };
    expect(extractBlockTitle(block)).toBe("");
  });
});
