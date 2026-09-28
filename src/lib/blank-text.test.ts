// isBlankText のテスト。
// 空白（trim() が落とすもの）と不可視の書式文字だけの文字列を「中身が無い」と判定すること、
// 文字が 1 つでもあれば「中身がある」と判定することを確認する。

import { describe, it, expect } from "vitest";
import { isBlankText } from "./blank-text";

describe("isBlankText", () => {
  it("空文字は中身が無い", () => {
    expect(isBlankText("")).toBe(true);
  });

  it("空白だけの文字列は中身が無い", () => {
    expect(isBlankText("   \n\t  ")).toBe(true);
  });

  it("不可視文字（ゼロ幅スペース）だけの文字列は中身が無い", () => {
    expect(isBlankText("\u200B\u200B\u200B")).toBe(true);
  });

  it("空白と不可視文字が混在していても中身が無い", () => {
    expect(isBlankText(" \u200B \u200C\n\u2060\uFEFF\u180E\u00AD ")).toBe(true);
  });

  it("不可視文字を含んでいても文字があれば中身がある", () => {
    expect(isBlankText("\u200Bhello\u200B")).toBe(false);
  });

  it("普通の文章は中身がある", () => {
    expect(isBlankText("ページの要約")).toBe(false);
  });
});
