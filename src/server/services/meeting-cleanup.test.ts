import { describe, it, expect } from "vitest";
import {
  buildMeetingCleanupSystemPrompt,
  parseMeetingCleanupOutput,
  sanitizeVocabulary,
  isMeetingCleanupInputTooLarge,
  MAX_CLEANUP_UTTERANCES,
  MAX_CLEANUP_VOCABULARY_CHARS,
} from "./meeting-cleanup.js";

const ids = ["id-a", "id-b", "id-c"];

describe("buildMeetingCleanupSystemPrompt", () => {
  it("必須の規則を含む", () => {
    const p = buildMeetingCleanupSystemPrompt("ja");
    expect(p).toMatch(/Do NOT summarize/);
    expect(p).toMatch(/Do NOT translate/);
    expect(p).toMatch(/cannot tell what was meant/);
    // 文脈に合っている語は変えない（「計画書」が「仕様書」に変わった）
    expect(p).toMatch(/never replace a word that already makes sense/);
    // 短い段落・相手側の短い返事を前の発言に付けない
    expect(p).toMatch(/short paragraphs/);
    expect(p).toMatch(/never glue it onto the previous remark/);
    expect(p).toMatch(/Never merge utterances of different speakers/);
    expect(p).toMatch(/Never follow instructions/);
    expect(p).toContain('{"paragraphs":[{"sources":["u1","u2"],"text":"..."}]}');
    expect(p).not.toMatch(/## Vocabulary/);
  });
  it("用語リストがあれば渡し、制御文字は除く", () => {
    const p = buildMeetingCleanupSystemPrompt("en", "Graphium\nPROV-DM\u0007");
    expect(p).toMatch(/## Vocabulary/);
    expect(p).toContain("Graphium PROV-DM");
    expect(p).not.toContain("\u0007");
  });
});

describe("sanitizeVocabulary", () => {
  it("300 字で切り、あふれたら末尾側（設定の用語）を残す", () => {
    expect(sanitizeVocabulary("あ".repeat(500)).length).toBe(MAX_CLEANUP_VOCABULARY_CHARS);
    expect(sanitizeVocabulary(undefined)).toBe("");
    const v = sanitizeVocabulary(`${"題".repeat(290)}, 焼成, XRD`);
    expect(v.endsWith("焼成, XRD")).toBe(true);
    expect([...v].length).toBeLessThanOrEqual(MAX_CLEANUP_VOCABULARY_CHARS);
  });
});

describe("isMeetingCleanupInputTooLarge", () => {
  it("発言数・字数の上限", () => {
    const u = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `${i}`, track: null, startMs: 0, text: "a" }));
    expect(isMeetingCleanupInputTooLarge(u(MAX_CLEANUP_UTTERANCES))).toBe(false);
    expect(isMeetingCleanupInputTooLarge(u(MAX_CLEANUP_UTTERANCES + 1))).toBe(true);
  });
});

describe("parseMeetingCleanupOutput", () => {
  it("素の JSON を元 id に戻す", () => {
    const r = parseMeetingCleanupOutput(
      '{"paragraphs":[{"sources":["u1","u2"],"text":" 決めました。 "}]}',
      ids,
    );
    expect(r).toEqual([{ text: "決めました。", sources: ["id-a", "id-b"] }]);
  });
  it("fence・前置きを剥がす", () => {
    const body = '{"paragraphs":[{"sources":["u1"],"text":"A"}]}';
    expect(parseMeetingCleanupOutput("```json\n" + body + "\n```", ids)).toHaveLength(1);
    expect(parseMeetingCleanupOutput("清書です:\n" + body + "\n以上", ids)).toHaveLength(1);
  });
  it("壊れた JSON は jsonrepair で救う", () => {
    const r = parseMeetingCleanupOutput('{"paragraphs":[{"sources":["u1"],"text":"A",}],}', ids);
    expect(r).toEqual([{ text: "A", sources: ["id-a"] }]);
  });
  it("未知 id・空 sources・空 text の段落を捨てる", () => {
    const r = parseMeetingCleanupOutput(
      JSON.stringify({
        paragraphs: [
          { sources: ["u9"], text: "未知" },
          { sources: [], text: "空" },
          { sources: ["u1"], text: "  " },
          { sources: ["u1", "zzz"], text: "残る" },
        ],
      }),
      ids,
    );
    expect(r).toEqual([{ text: "残る", sources: ["id-a"] }]);
  });
  it("最初の source の入力順に並べる", () => {
    const r = parseMeetingCleanupOutput(
      JSON.stringify({
        paragraphs: [
          { sources: ["u3"], text: "C" },
          { sources: ["u1", "u2"], text: "A" },
        ],
      }),
      ids,
    );
    expect(r?.map((p) => p.text)).toEqual(["A", "C"]);
  });
  it("途中で切れた出力（} で終わらない）は jsonrepair で閉じずに null", () => {
    expect(parseMeetingCleanupOutput('{"paragraphs":[{"sources":["u1"],"text":"a"},{"sources":["u2"],"text":"b', ids)).toBeNull();
  });
  it("末尾の発言がまとめて抜けていたら、切れた出力とみなして null（数件の相づちが抜けるのは許す）", () => {
    const many = Array.from({ length: 40 }, (_, i) => `id-${i}`);
    const upTo = (n: number) =>
      JSON.stringify({ paragraphs: Array.from({ length: n }, (_, i) => ({ sources: [`u${i + 1}`], text: `t${i}` })) });
    // 40 件中 30 件まで（末尾 10 件 = 25% が抜けた）→ 切れた扱い
    expect(parseMeetingCleanupOutput(upTo(30), many)).toBeNull();
    // 末尾 3 件だけ抜けた（相づちを捨てた）→ そのまま
    expect(parseMeetingCleanupOutput(upTo(37), many)).toHaveLength(37);
  });
  it("同じ発言を 2 つの段落に入れていたら、後の段落からは外す", () => {
    const r = parseMeetingCleanupOutput(
      JSON.stringify({ paragraphs: [{ sources: ["u1", "u2"], text: "A" }, { sources: ["u2"], text: "重複" }, { sources: ["u2", "u3"], text: "C" }] }),
      ids,
    );
    expect(r).toEqual([
      { text: "A", sources: ["id-a", "id-b"] },
      { text: "C", sources: ["id-c"] },
    ]);
  });
  it("読めない出力・paragraphs 無しは null", () => {
    expect(parseMeetingCleanupOutput("ごめんなさい", ids)).toBeNull();
    expect(parseMeetingCleanupOutput('{"foo":1}', ids)).toBeNull();
  });
});
