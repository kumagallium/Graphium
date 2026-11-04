// 書き足し（rewriteAndMerge）の言語と、その言語で選ぶ Skill
//
// 書き足し先のページは保存済みの言語で書き直す。Skill も同じ言語で選ばないと、
// ko の画面から ja のページに書き足したとき ja の本文に ko の Skill が当たる。

import { describe, it, expect } from "vitest";
import type { GraphiumDocument } from "../../lib/document-types";
import type { GenerationLanguage } from "../../lib/language";
import { pickActiveSkills, type SkillMetaSummary } from "../skill/skill-service";
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

  it("書き足しの Skill は書き足し先の言語で選ぶ（ko の画面 → ja のページ）", () => {
    const meta = (title: string, language?: GenerationLanguage): SkillMetaSummary => ({
      title,
      description: "",
      availableForIngest: true,
      ...(language ? { language } : {}),
    });
    const metas = new Map<string, SkillMetaSummary>([
      ["any", meta("any")],
      ["ja", meta("ja", "ja")],
      ["ko", meta("ko", "ko")],
    ]);
    const skillDoc = { pages: [{ blocks: [] }] } as unknown as GraphiumDocument;
    const titles = pickActiveSkills(metas, () => skillDoc, mergeRewriteLanguage(page("ja"), "ko"))
      .map((s) => s.title)
      .sort();
    expect(titles).toEqual(["any", "ja"]);
  });
});
