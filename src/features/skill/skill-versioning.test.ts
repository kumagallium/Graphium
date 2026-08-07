// システムスキルのデフォルト版同期のテスト
// 未編集判定（正規化ハッシュ）と decideSkillSync の分岐を検証する

import { describe, it, expect } from "vitest";
import {
  normalizeSkillPrompt,
  hashSkillPrompt,
  computeSystemSkillDefaultHash,
  buildSystemSkillDocument,
  extractSkillPrompt,
  decideSkillSync,
} from "./skill-service";
import { SYSTEM_SKILLS, type SystemSkillDefinition } from "./system-skills";

const TEST_DEF: SystemSkillDefinition = {
  id: "default-voice-ja",
  version: 3,
  title: "Test Voice",
  description: "テスト用",
  language: "ja",
  availableForIngest: true,
  prompt: "## Voice\n\n- 敬体で書く\n- **強い語彙**を避ける\n",
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
