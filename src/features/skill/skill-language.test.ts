// スキルの適用言語と生成言語（ko を含む）
//
// 方針: 生成言語と一致するスキルと、言語未指定のスキルだけを渡す。ko の生成に en / ja 専用の
// 文体スキルは使わない（言語固有の書き方の決まりが混ざるため）。Knowledge Schema の同梱本文は
// ja / en のみで、ko では英語版を使う（プロンプト本文が英語のため）。

import { describe, it, expect } from "vitest";
import type { GraphiumDocument } from "../../lib/document-types";
import type { GenerationLanguage } from "../../lib/language";
import { pickActiveSkills, resolveSystemSkillDefinition, type SkillMetaSummary } from "./skill-service";
import { KNOWLEDGE_SCHEMA_PROMPTS, SYSTEM_SKILLS } from "./system-skills";

const doc = { pages: [{ blocks: [] }] } as unknown as GraphiumDocument;
const meta = (title: string, language?: GenerationLanguage): SkillMetaSummary => ({
  title,
  description: "",
  availableForIngest: true,
  ...(language ? { language } : {}),
});

const metas = new Map<string, SkillMetaSummary>([
  ["any", meta("any")],
  ["ja", meta("ja", "ja")],
  ["en", meta("en", "en")],
  ["ko", meta("ko", "ko")],
]);
const titles = (language: GenerationLanguage) =>
  pickActiveSkills(metas, () => doc, language).map((s) => s.title).sort();

describe("pickActiveSkills()", () => {
  it("ko の生成には言語未指定と ko のスキルだけ", () => {
    expect(titles("ko")).toEqual(["any", "ko"]);
  });
  it("ja / en は従来どおり", () => {
    expect(titles("ja")).toEqual(["any", "ja"]);
    expect(titles("en")).toEqual(["any", "en"]);
  });
});

describe("resolveSystemSkillDefinition()（Knowledge Schema）", () => {
  const base = SYSTEM_SKILLS.find((s) => s.id === "knowledge-schema")!;
  it("ko では英語版の同梱本文を使う", () => {
    const def = resolveSystemSkillDefinition(base, "ko");
    expect(def.language).toBe("en");
    expect(def.prompt).toBe(KNOWLEDGE_SCHEMA_PROMPTS.en);
  });
  it("ja / en は従来どおり", () => {
    expect(resolveSystemSkillDefinition(base, "ja").prompt).toBe(KNOWLEDGE_SCHEMA_PROMPTS.ja);
    expect(resolveSystemSkillDefinition(base, "en").prompt).toBe(KNOWLEDGE_SCHEMA_PROMPTS.en);
  });
});
