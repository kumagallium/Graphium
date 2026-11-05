// 書き足し（rewriteAndMerge と MCP の清書の課題）で本文を書く言語。
// Skill もこの言語で選ぶ（rewriteAndMerge 側のテストは topic-stage.model-name.test.ts）。

import { describe, it, expect } from "vitest";
import type { GraphiumDocument } from "../../lib/document-types";
import { mergeRewriteLanguage } from "./wiki-service";

const page = (language?: string) =>
  ({ pages: [{ blocks: [] }], ...(language !== undefined ? { wikiMeta: { language } } : {}) }) as unknown as GraphiumDocument;

describe("mergeRewriteLanguage()", () => {
  it("保存済みの言語を呼び出し元の言語より優先する", () => {
    expect(mergeRewriteLanguage(page("ja"), "ko")).toBe("ja");
    expect(mergeRewriteLanguage(page("ko"), "ja")).toBe("ko");
  });
  it("保存言語が無ければ呼び出し元の言語、どちらも無ければ en", () => {
    expect(mergeRewriteLanguage(page(), "ko")).toBe("ko");
    expect(mergeRewriteLanguage(page())).toBe("en");
  });
  it("空文字の保存言語は未設定と同じ（呼び出し元の言語）", () => {
    expect(mergeRewriteLanguage(page(""), "ko")).toBe("ko");
  });
  it("生成に未対応の言語は en に寄せる", () => {
    expect(mergeRewriteLanguage(page("fr"), "ja")).toBe("en");
  });
});
