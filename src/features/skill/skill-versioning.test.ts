// システムスキルのデフォルト版同期のテスト
// 未編集判定（正規化ハッシュ）と decideSkillSync の分岐を検証する

import { describe, it, expect } from "vitest";
import {
  normalizeSkillPrompt,
  hashSkillPrompt,
  computeSystemSkillDefaultHash,
  buildSystemSkillDocument,
  buildSkillDocument,
  extractSkillPrompt,
  decideSkillSync,
  extractKnowledgeSchemaPrompt,
  loadKnowledgeSchemaPrompt,
  buildKnowledgeSchemaPromptSection,
  applySkillMetadataUpdate,
  buildSyncedSystemSkillMeta,
  decideSystemSkillNormalization,
  isKnowledgeSchemaListedButNotLoaded,
  resolveSystemSkillDefinition,
  resolveSystemSkillDefinitionForDocument,
} from "./skill-service";
import { KNOWLEDGE_SCHEMA_PROMPTS, SYSTEM_SKILLS, type SystemSkillDefinition } from "./system-skills";

const TEST_DEF: SystemSkillDefinition = {
  id: "default-voice-ja",
  version: 3,
  title: "Test Voice",
  description: "テスト用",
  language: "ja",
  availableForIngest: true,
  prompt: "## Voice\n\n- 敬体で書く\n- **強い語彙**を避ける\n",
};

const KNOWLEDGE_SCHEMA_V1_DEF: SystemSkillDefinition = {
  id: "knowledge-schema",
  version: 1,
  title: "Knowledge Schema / ナレッジスキーマ",
  description: "Conventions for Topics, Answers, Claims, citations, revision, and upkeep / ナレッジ生成・引用・改訂の規約",
  language: "en",
  availableForIngest: false,
  prompt: `## Knowledge Schema

This document defines the structure and maintenance conventions for Graphium's Knowledge layer. It is independent from writing Voice. Code-level safety rules, structured-output validation, citation verification, and guardrails remain mandatory even when this document is edited.

## Topic and Answer

- A Topic is a source-grounded page about one concept. An Answer is a source-grounded page that keeps answering its title question; do not turn it into a general survey.
- Revise the complete page from the current body and the new source. Keep distinct source-specific statements separate when their conditions, cases, numbers, assumptions, or scope differ.
- Every factual sentence needs an inline source citation. Preserve a hedge, uncertainty, contradiction, and open question when the source has one. Do not invent a citation, mechanism, or generalization.

## Claim

- A Claim is one transferable proposition supported by its source, not a summary or textbook filler.
- Keep claims atomic: split independently useful propositions and do not combine evidence from unrelated sources into one assertion.
- Retain conditions, evidence limits, and epistemic strength. Classify only from what the source supports.

## Citation and revision

- Use the exact citation identifiers supplied by Graphium. Citations must support the sentence they end.
- A revision incorporates new evidence without silently erasing supported prior evidence. Explicit conflicts belong in a disagreement or open-question section.
- Do not fabricate sources, URLs, quotations, measurements, or provenance.

## Upkeep

- Prefer a precise, traceable page over a broad but weak one.
- Surface missing support, stale statements, duplicates, contradictions, and unresolved questions for review.
- Do not make destructive maintenance decisions or overwrite human-owned content without the corresponding Graphium workflow.`,
};

describe("normalizeSkillPrompt", () => {
  it("空行と行頭行末の空白を無視する", () => {
    const a = "## Voice\n\n- 敬体で書く\n";
    const b = "  ## Voice  \n\n\n\n- 敬体で書く";
    expect(normalizeSkillPrompt(a)).toBe(normalizeSkillPrompt(b));
  });

  it("行の内容が違えば正規化後も違う", () => {
    expect(normalizeSkillPrompt("- 敬体で書く")).not.toBe(normalizeSkillPrompt("- 常体で書く"));
  });
});

describe("hashSkillPrompt", () => {
  it("空行の数だけが違うプロンプトは同一ハッシュになる", async () => {
    const a = await hashSkillPrompt("## Voice\n\n- 敬体で書く");
    const b = await hashSkillPrompt("## Voice\n\n\n\n- 敬体で書く\n\n");
    expect(a).toBe(b);
  });

  it("内容が違えばハッシュも違う", async () => {
    const a = await hashSkillPrompt("- 敬体で書く");
    const b = await hashSkillPrompt("- 常体で書く");
    expect(a).not.toBe(b);
  });
});

describe("computeSystemSkillDefaultHash / buildSystemSkillDocument の往復整合", () => {
  it("生成した文書から抽出したプロンプトのハッシュがデフォルトハッシュと一致する（未編集判定の前提）", async () => {
    const doc = await buildSystemSkillDocument(TEST_DEF);
    const extracted = await hashSkillPrompt(extractSkillPrompt(doc));
    expect(extracted).toBe(await computeSystemSkillDefaultHash(TEST_DEF));
  });

  it("同梱の全システムスキルで往復整合が成立する", async () => {
    for (const def of SYSTEM_SKILLS) {
      const doc = await buildSystemSkillDocument(def);
      const extracted = await hashSkillPrompt(extractSkillPrompt(doc));
      expect(extracted, `roundtrip mismatch: ${def.id}`).toBe(await computeSystemSkillDefaultHash(def));
    }
  });

  it("skillMeta に版とデフォルトハッシュが埋め込まれる", async () => {
    const doc = await buildSystemSkillDocument(TEST_DEF);
    expect(doc.skillMeta?.systemSkillVersion).toBe(3);
    expect(doc.skillMeta?.defaultPromptHash).toBe(await computeSystemSkillDefaultHash(TEST_DEF));
    expect(doc.skillMeta?.systemSkillId).toBe("default-voice-ja");
  });
});

describe("decideSkillSync", () => {
  it("版情報のない旧文書は migrate_meta（内容は触らずサイレント移行）", () => {
    expect(decideSkillSync(TEST_DEF, undefined, "whatever")).toBe("migrate_meta");
    expect(decideSkillSync(TEST_DEF, {}, "whatever")).toBe("migrate_meta");
  });

  describe("Knowledge Schema", () => {
    it("SYSTEM_SKILLS 上の Schema 定義は固定 ID の 1 件だけ", () => {
      const definitions = SYSTEM_SKILLS.filter((skill) => skill.id === "knowledge-schema");
      expect(definitions).toHaveLength(1);
      expect(definitions[0].version).toBe(3);
      expect(definitions[0].availableForIngest).toBe(false);
    });

    it("初回 locale ja/en に応じて Schema definition/document の本文と言語が変わる", async () => {
      const base = SYSTEM_SKILLS.find((skill) => skill.id === "knowledge-schema")!;
      const jaDef = resolveSystemSkillDefinition(base, "ja");
      const enDef = resolveSystemSkillDefinition(base, "en");

      expect(jaDef).toMatchObject({ id: "knowledge-schema", language: "ja", prompt: KNOWLEDGE_SCHEMA_PROMPTS.ja });
      expect(enDef).toMatchObject({ id: "knowledge-schema", language: "en", prompt: KNOWLEDGE_SCHEMA_PROMPTS.en });
      expect(jaDef.prompt).not.toBe(enDef.prompt);

      const jaDoc = await buildSystemSkillDocument(jaDef);
      const enDoc = await buildSystemSkillDocument(enDef);
      expect(jaDoc.skillMeta?.language).toBe("ja");
      expect(enDoc.skillMeta?.language).toBe("en");
      expect(extractSkillPrompt(jaDoc)).toContain("## 編集ガイド");
      expect(extractSkillPrompt(enDoc)).toContain("## Editing guide");
    });

    it("保存済み Schema の language が UI locale 変更より優先される", async () => {
      const base = SYSTEM_SKILLS.find((skill) => skill.id === "knowledge-schema")!;
      const savedJa = await buildSystemSkillDocument(resolveSystemSkillDefinition(base, "ja"));
      const resolved = resolveSystemSkillDefinitionForDocument(
        resolveSystemSkillDefinition(base, "en"),
        savedJa,
      );

      expect(resolved.language).toBe("ja");
      expect(resolved.prompt).toBe(KNOWLEDGE_SCHEMA_PROMPTS.ja);
    });

    it("metadata更新で日本語Schemaのlanguageを英語へ変更しない", async () => {
      const base = await buildSystemSkillDocument(
        resolveSystemSkillDefinition(
          SYSTEM_SKILLS.find((skill) => skill.id === "knowledge-schema")!,
          "ja",
        ),
      );
      const updated = applySkillMetadataUpdate(base, {
        title: base.title,
        description: "updated",
        availableForIngest: false,
        language: "en",
      });

      expect(updated.skillMeta?.language).toBe("ja");
      expect(updated.skillMeta?.description).toBe("updated");
    });

    it("通常Skillのmetadata更新では選択したlanguageを保存する", async () => {
      const base = await buildSystemSkillDocument(TEST_DEF);
      const updated = applySkillMetadataUpdate(base, {
        title: base.title,
        description: "updated",
        availableForIngest: true,
        language: "en",
      });

      expect(updated.skillMeta?.language).toBe("en");
    });

    it("language 未設定の旧 Schema は en として解決し、同期 metadata に固定する", () => {
      const base = SYSTEM_SKILLS.find((skill) => skill.id === "knowledge-schema")!;
      const resolved = resolveSystemSkillDefinitionForDocument(base, {
        skillMeta: {
          description: "legacy",
          availableForIngest: false,
          createdAt: "2026-01-01T00:00:00Z",
          systemSkillId: "knowledge-schema",
        },
      });
      const synced = buildSyncedSystemSkillMeta(
        {
          description: "legacy",
          availableForIngest: false,
          createdAt: "2026-01-01T00:00:00Z",
          systemSkillId: "knowledge-schema",
        },
        resolved,
        "resolved-hash",
      );

      expect(resolved.language).toBe("en");
      expect(synced.language).toBe("en");
      expect(synced.defaultPromptHash).toBe("resolved-hash");
    });

    it("日本語本文に編集ガイドの重要語・分野横断例・一般規約が含まれる", () => {
      const prompt = KNOWLEDGE_SCHEMA_PROMPTS.ja;
      for (const word of [
        "安全に変更してよい",
        "分野用語",
        "必ず残す条件",
        "引用粒度",
        "Schemaで変更不可",
        "[[source:id]]",
        "人間所有文書",
        "ソフトウェア",
        "企画",
        "学習",
        "実行環境",
        "判断基準",
        "確信度",
        "Topic",
        "Answer",
        "Claim",
        "引用",
        "根拠",
        "不確実性",
        "改訂",
        "lint",
        "upkeep",
      ]) {
        expect(prompt).toContain(word);
      }
      for (const specialized of ["材料科学", "試料組成", "測定条件"]) {
        expect(prompt).not.toContain(specialized);
      }
    });

    describe("decideSystemSkillNormalization", () => {
      it("固定 ID が古く random ID が新しければ random を source、固定 ID を target にする", () => {
        expect(decideSystemSkillNormalization("knowledge-schema", [
          { id: "knowledge-schema", modifiedAt: "2026-01-01T00:00:00Z" },
          { id: "random-new", modifiedAt: "2026-02-01T00:00:00Z" },
        ])).toEqual({
          sourceId: "random-new",
          targetId: "knowledge-schema",
          deleteIds: ["random-new"],
        });
      });

      it("固定 ID がなければ最新 random を固定 ID へ移し、全 random を削除する", () => {
        expect(decideSystemSkillNormalization("knowledge-schema", [
          { id: "random-old", modifiedAt: "2026-01-01T00:00:00Z" },
          { id: "random-new", modifiedAt: "2026-02-01T00:00:00Z" },
        ])).toEqual({
          sourceId: "random-new",
          targetId: "knowledge-schema",
          deleteIds: ["random-old", "random-new"],
        });
      });

      it("他 system skill は従来どおり最新 ID 自身を survivor にする", () => {
        expect(decideSystemSkillNormalization("default-voice-ja", [
          { id: "voice-old", modifiedAt: "2026-01-01T00:00:00Z" },
          { id: "voice-new", modifiedAt: "2026-02-01T00:00:00Z" },
        ])).toEqual({
          sourceId: "voice-new",
          targetId: "voice-new",
          deleteIds: ["voice-old"],
        });
      });
    });

    describe("isKnowledgeSchemaListedButNotLoaded", () => {
      it("固定 ID が listed だが loaded でなければ true", () => {
        expect(isKnowledgeSchemaListedButNotLoaded(
          ["knowledge-schema", "random-duplicate"],
          new Set(["random-duplicate"]),
        )).toBe(true);
      });

      it("固定 ID が listed かつ loaded なら false", () => {
        expect(isKnowledgeSchemaListedButNotLoaded(
          ["knowledge-schema", "random-duplicate"],
          new Set(["knowledge-schema", "random-duplicate"]),
        )).toBe(false);
      });

      it("固定 ID が listed でなければ false", () => {
        expect(isKnowledgeSchemaListedButNotLoaded(
          ["random-duplicate"],
          new Set(["random-duplicate"]),
        )).toBe(false);
      });
    });

    it("英語本文にも等価な分野横断 editing guide が含まれる", () => {
      const prompt = KNOWLEDGE_SCHEMA_PROMPTS.en;
      for (const word of [
        "Safe to change",
        "domain terminology",
        "conditions that must always be retained",
        "citation granularity",
        "Not changeable",
        "[[source:id]]",
        "human-owned documents",
        "software",
        "planning",
        "learning",
        "runtime environments",
        "decision criteria",
        "confidence",
      ]) {
        expect(prompt).toContain(word);
      }
      for (const specialized of ["materials science", "sample composition", "measurement conditions"]) {
        expect(prompt).not.toContain(specialized);
      }
    });

    it("同梱 Schema を保存可能な system Skill として生成・抽出する", async () => {
      const definition = SYSTEM_SKILLS.find((skill) => skill.id === "knowledge-schema");
      expect(definition).toBeDefined();
      const doc = await buildSystemSkillDocument(definition!);
      expect(doc.source).toBe("skill");
      expect(doc.skillMeta?.systemSkillId).toBe("knowledge-schema");
      expect(extractKnowledgeSchemaPrompt(doc)).toContain("## Claim");
    });

    it("Schema 以外の Skill を Knowledge Schema として抽出しない", async () => {
      const doc = await buildSystemSkillDocument(TEST_DEF);
      expect(() => extractKnowledgeSchemaPrompt(doc)).toThrow("Knowledge Schema");
    });

    it("Schema の取得失敗を既定本文へフォールバックせず呼び出し元へ返す", async () => {
      await expect(loadKnowledgeSchemaPrompt(async () => {
        throw new Error("storage unavailable");
      })).rejects.toThrow("storage unavailable");
    });

    it("保存済みの日本語自由編集本文を既定本文へ戻さず AI prompt 用に返す", async () => {
      const customPrompt = "## ナレッジスキーマ\n\nソフトウェアではバージョンと再現手順を必ず残す。";
      const doc = buildSkillDocument(
        "Knowledge Schema / ナレッジスキーマ",
        "custom schema",
        customPrompt,
        false,
        {
          systemSkillId: "knowledge-schema",
          language: "ja",
          systemSkillVersion: 3,
          defaultPromptHash: "edited",
        },
      );

      await expect(loadKnowledgeSchemaPrompt(async () => doc)).resolves.toBe(customPrompt);
    });

    it("Voice/Skill とは独立したプロンプト section を構築する", () => {
      expect(buildKnowledgeSchemaPromptSection("schema body")).toBe("\n\n## Knowledge Schema\n\nschema body");
    });

    it("旧版の英語 Schema が未編集なら auto_update、編集済みなら notify_newer", async () => {
      const current = resolveSystemSkillDefinition(SYSTEM_SKILLS.find((skill) => skill.id === "knowledge-schema")!, "en");
      const oldDoc = await buildSystemSkillDocument(KNOWLEDGE_SCHEMA_V1_DEF);
      const oldHash = await hashSkillPrompt(extractSkillPrompt(oldDoc));

      expect(decideSkillSync(current, oldDoc.skillMeta, oldHash)).toBe("auto_update");
      expect(decideSkillSync(current, oldDoc.skillMeta, await hashSkillPrompt(`${extractSkillPrompt(oldDoc)}\n\nUser edit`))).toBe("notify_newer");
    });

    it("Schema の roundtrip hash が日英双方で成立する", async () => {
      const base = SYSTEM_SKILLS.find((skill) => skill.id === "knowledge-schema")!;
      for (const language of ["ja", "en"] as const) {
        const def = resolveSystemSkillDefinition(base, language);
        const doc = await buildSystemSkillDocument(def);
        const extracted = await hashSkillPrompt(extractSkillPrompt(doc));
        expect(extracted, `roundtrip mismatch: knowledge-schema ${language}`).toBe(await computeSystemSkillDefaultHash(def));
      }
    });
  });

  it("版が同じか新しい文書は up_to_date", () => {
    expect(decideSkillSync(TEST_DEF, { systemSkillVersion: 3, defaultPromptHash: "h" }, "h")).toBe("up_to_date");
    expect(decideSkillSync(TEST_DEF, { systemSkillVersion: 4, defaultPromptHash: "h" }, "x")).toBe("up_to_date");
  });

  it("デフォルトが新しく未編集（ハッシュ一致）なら auto_update", () => {
    expect(decideSkillSync(TEST_DEF, { systemSkillVersion: 2, defaultPromptHash: "same" }, "same")).toBe("auto_update");
  });

  it("デフォルトが新しく編集済み（ハッシュ不一致）なら notify_newer", () => {
    expect(decideSkillSync(TEST_DEF, { systemSkillVersion: 2, defaultPromptHash: "old-default" }, "edited")).toBe("notify_newer");
  });

  it("デフォルトが新しくてもハッシュ記録が無ければ notify_newer（安全側）", () => {
    expect(decideSkillSync(TEST_DEF, { systemSkillVersion: 2 }, "whatever")).toBe("notify_newer");
  });
});
