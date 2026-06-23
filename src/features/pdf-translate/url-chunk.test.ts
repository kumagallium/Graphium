// URL 全文翻訳のヘルパー（言語判定・段落チャンク分割）のテスト。
// 翻訳本体は LLM 依存なので、ここでは前段の純粋ロジックだけを固定する。

import { describe, it, expect } from "vitest";
import { isSameLanguage, chunkTextByParagraph } from "./url-chunk";

describe("isSameLanguage", () => {
  it("基底サブタグが一致すれば true（en-US と en）", () => {
    expect(isSameLanguage("en-US", "en")).toBe(true);
    expect(isSameLanguage("ja-JP", "ja")).toBe(true);
    expect(isSameLanguage("EN", "en")).toBe(true); // 大小無視
  });

  it("言語が異なれば false", () => {
    expect(isSameLanguage("en", "ja")).toBe(false);
    expect(isSameLanguage("fr-FR", "en-US")).toBe(false);
  });

  it("どちらかが空 / null なら false（判定不能は翻訳を妨げない）", () => {
    expect(isSameLanguage(null, "ja")).toBe(false);
    expect(isSameLanguage("ja", undefined)).toBe(false);
    expect(isSameLanguage("", "")).toBe(false);
  });
});

describe("chunkTextByParagraph", () => {
  it("空テキストは空配列", () => {
    expect(chunkTextByParagraph("", 100)).toEqual([]);
    expect(chunkTextByParagraph("   \n\n  ", 100)).toEqual([]);
  });

  it("max 内に収まる複数段落は 1 チャンクにまとめる", () => {
    const text = "A".repeat(10) + "\n\n" + "B".repeat(10);
    expect(chunkTextByParagraph(text, 100)).toEqual([
      "A".repeat(10) + "\n\n" + "B".repeat(10),
    ]);
  });

  it("max を超えたら段落境界で分割する", () => {
    const p1 = "A".repeat(60);
    const p2 = "B".repeat(60);
    const p3 = "C".repeat(60);
    // p1+p2 は 120 + 2 > 100 なので p1 / p2+? で割れる
    const chunks = chunkTextByParagraph([p1, p2, p3].join("\n\n"), 100);
    expect(chunks).toEqual([p1, p2, p3]);
    // 各チャンクは元の段落をそのまま保持（途中で切らない）
    for (const c of chunks) expect(c.length).toBe(60);
  });

  it("単一段落が max を超えてもそのまま 1 チャンク（途中で切らない）", () => {
    const huge = "X".repeat(500);
    expect(chunkTextByParagraph(huge, 100)).toEqual([huge]);
  });

  it("3 連続以上の空行も段落区切りとして扱う", () => {
    const text = "one\n\n\n\ntwo";
    expect(chunkTextByParagraph(text, 100)).toEqual(["one\n\ntwo"]);
  });
});
