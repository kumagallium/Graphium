// 韓国語（ko）での生成: 出力言語の指示が ko を指し、英語の指示が残らないこと。
// ja / en のプロンプトは変えていない（このテストでは ja / en が従来の指示のままかも確かめる）。

import { describe, it, expect, vi, afterEach } from "vitest";
import { buildRewriterSystemPrompt } from "./wiki-rewriter.js";
import { buildIngesterSystemPrompt } from "./wiki-ingester.js";
import { buildLinterSystemPrompt } from "./wiki-linter.js";
import {
  buildAnswerRewriterSystemPrompt,
  buildSourceSummarySystemPrompt,
  buildSourceSurveySystemPrompt,
  buildSourceTopicReviserSystemPrompt,
  buildTopicConsolidatorSystemPrompt,
  buildTopicMergerSystemPrompt,
  buildTopicRouterSystemPrompt,
} from "./wiki-topic-writer.js";
import {
  buildAtomDuplicateJudgeSystemPrompt,
  buildAtomizerSystemPrompt,
  buildFoldJudgeSystemPrompt,
  buildReliftSystemPrompt,
  buildTransferJudgeSystemPrompt,
} from "./wiki-atomizer.js";
import { buildSourceCheckSystemPrompt } from "./source-check.js";
import { buildWebGroundedSystemPrompt, buildWorldGroundingSystemPrompt } from "./world-grounding.js";
import {
  buildProvIngesterSystemPrompt,
  hasHeadingLanguageMismatch,
  provLanguageRetryNudge,
  type ProvIngesterBlock,
} from "./prov-ingester.js";
import { buildMeetingSummarySystemPrompt, buildMeetingSummaryUserMessage } from "./meeting-summary.js";
import { buildMeetingCleanupSystemPrompt } from "./meeting-cleanup.js";
import { maskPlaceholders, maskText } from "../../lib/meeting-mask.js";
import { chatReplyLanguageInstruction } from "../../lib/language.js";
import { searchWikipedia } from "./grounding-providers.js";

/** 出力言語を名指しする指示（「Output in: X」「Output language: X」「Write … in X」など） */
const DIRECTIVE = /(Output in: |Output language: |in the note's own language \(|Canonical titles must stay in: |Write all text in |in )(Japanese|English|Korean)/g;
const directedLanguages = (prompt: string) => [...prompt.matchAll(DIRECTIVE)].map((m) => m[2]);

const builders: Record<string, (language: string) => string> = {
  rewriter: (l) => buildRewriterSystemPrompt(l),
  ingester: (l) => buildIngesterSystemPrompt(l, []),
  linter: (l) => buildLinterSystemPrompt(l),
  topicConsolidator: (l) => buildTopicConsolidatorSystemPrompt(l),
  topicRouter: (l) => buildTopicRouterSystemPrompt(l),
  sourceTopicReviser: (l) => buildSourceTopicReviserSystemPrompt(l),
  sourceSurvey: (l) => buildSourceSurveySystemPrompt(l),
  topicMerger: (l) => buildTopicMergerSystemPrompt(l),
  answerRewriter: (l) => buildAnswerRewriterSystemPrompt(l),
  sourceSummary: (l) => buildSourceSummarySystemPrompt(l),
  atomizer: (l) => buildAtomizerSystemPrompt(l),
  relift: (l) => buildReliftSystemPrompt(l),
  transferJudge: (l) => buildTransferJudgeSystemPrompt(l),
  foldJudge: (l) => buildFoldJudgeSystemPrompt(l),
  atomDuplicateJudge: (l) => buildAtomDuplicateJudgeSystemPrompt(l),
};

describe("出力言語の指示", () => {
  for (const [name, build] of Object.entries(builders)) {
    it(`${name}: ko は Korean を指し、English / Japanese の指示を残さない`, () => {
      const langs = directedLanguages(build("ko"));
      expect(langs.length).toBeGreaterThan(0);
      expect(new Set(langs)).toEqual(new Set(["Korean"]));
    });
    it(`${name}: ja / en は従来どおり Japanese / English を指す`, () => {
      expect(directedLanguages(build("ja"))).toContain("Japanese");
      expect(directedLanguages(build("ja"))).not.toContain("Korean");
      expect(directedLanguages(build("en"))).toContain("English");
      expect(directedLanguages(build("en"))).not.toContain("Korean");
    });
  }
});

describe("出典照合・世界照合の rationale", () => {
  it("出典照合: ko は rationale を Korean で書かせる", () => {
    const p = buildSourceCheckSystemPrompt("ko");
    expect(p).toContain("Write rationale in Korean");
    expect(p).not.toContain("Write rationale in English");
  });
  it("世界照合: ko は Korean で書かせ、keywords に韓国語も混ぜる", () => {
    for (const p of [buildWorldGroundingSystemPrompt("ko"), buildWebGroundedSystemPrompt("ko")]) {
      expect(p).toContain("normalizedClaim in Korean");
      expect(p).toContain("Mix Korean, English and Japanese synonyms");
    }
    expect(buildWorldGroundingSystemPrompt("en")).toContain("normalizedClaim in English");
  });
  it("世界照合: ko は本文中の固定の英語指示（keywords の言語・根拠なしの rationale）も韓国語向けにする", () => {
    for (const p of [buildWorldGroundingSystemPrompt("ko"), buildWebGroundedSystemPrompt("ko")]) {
      expect(p).not.toContain("multilingual ja/en mix");
      expect(p).toContain("multilingual ko/en/ja mix");
    }
    const web = buildWebGroundedSystemPrompt("ko");
    expect(web).not.toContain("found no direct prior art");
    expect(web).toContain("직접적인 선행 사례를 찾지 못했습니다");
    // ja / en は従来の文言のまま
    expect(buildWebGroundedSystemPrompt("en")).toContain("found no direct prior art");
    expect(buildWebGroundedSystemPrompt("ja")).toContain("multilingual ja/en mix");
  });
});

describe("PROV（手順ノート化）", () => {
  const heading = (text: string): ProvIngesterBlock => ({ blockType: "heading", text }) as ProvIngesterBlock;

  it("ko は見出しも韓国語で書かせる", () => {
    const p = buildProvIngesterSystemPrompt("ko");
    expect(p).toContain("Korean. Do NOT reuse the English stepId as the heading text");
    expect(p).not.toContain("match the source language, or English if ambiguous");
  });
  it("en は従来どおり原文の言語に従う", () => {
    expect(buildProvIngesterSystemPrompt("en")).toContain("match the source language, or English if ambiguous");
  });
  it("ko で見出しが英語なら書き直しの対象にする", () => {
    expect(hasHeadingLanguageMismatch("ko", [heading("Arc melting"), heading("Annealing")])).toBe(true);
    expect(hasHeadingLanguageMismatch("ko", [heading("아크 용해"), heading("어닐링")])).toBe(false);
  });
  it("ja の判定は従来どおり、en は判定しない", () => {
    expect(hasHeadingLanguageMismatch("ja", [heading("Arc melting"), heading("Annealing")])).toBe(true);
    expect(hasHeadingLanguageMismatch("en", [heading("Arc melting"), heading("Annealing")])).toBe(false);
  });
  it("書き直しの依頼は ko なら Korean を指す", () => {
    expect(provLanguageRetryNudge("ko")).toContain("Korean (한국어)");
    expect(provLanguageRetryNudge("ja")).toContain("Japanese (日本語)");
  });
});

describe("音声ノート", () => {
  it("要約は ko で書かせ、話者名も韓国語", () => {
    const p = buildMeetingSummarySystemPrompt("ko");
    expect(p).toContain("Write all text in Korean.");
    expect(p).toContain('"상대방"');
    const msg = buildMeetingSummaryUserMessage([{ id: "x", track: "system", startMs: 0, text: "안녕하세요" }], "ko");
    expect(msg).toContain("상대방: 안녕하세요");
  });
  it("清書は発話の言語を保つ（出力言語を指定しない）", () => {
    const p = buildMeetingCleanupSystemPrompt("ko");
    expect(p).toContain("Do NOT translate");
    expect(directedLanguages(p).filter((l) => l === "Korean" || l === "English")).toEqual([]);
    expect(p).toContain('"나"');
  });
  it("伏せ字の印は韓国語", () => {
    expect(maskPlaceholders("ko").person).toBe("[이름]");
    expect(buildMeetingSummarySystemPrompt("ko", undefined, true)).toContain("[이름]");
  });
});

describe("チャットの返答言語", () => {
  it("ko だけ返答言語を明示し、ja / en には何も足さない", () => {
    expect(chatReplyLanguageInstruction("ko")).toContain("Reply in Korean");
    expect(chatReplyLanguageInstruction("ja")).toBe("");
    expect(chatReplyLanguageInstruction("en")).toBe("");
  });
});

describe("伏せ字（韓国語）", () => {
  it("必ず伏せる語とメールアドレスを韓国語の印に置き換える", () => {
    const out = maskText("김철수 님에게 kim@example.com 으로 보냈습니다", ["김철수"], "ko");
    expect(out).toContain("[가림] 님에게");
    expect(out).toContain("[연락처]");
    expect(out).not.toContain("김철수");
  });
  it("AI が書いた印（[이름]）は中を壊さない", () => {
    expect(maskText("[이름] 님이 정했습니다", ["이름"], "ko")).toBe("[이름] 님이 정했습니다");
  });
});

describe("Wikipedia（ko）", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("ko は ko.wikipedia.org を引き、結果が無くても en で引き直さない", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ query: { search: [] } }), { status: 200 });
    }));
    const items = await searchWikipedia("열전 변환", "ko");
    expect(items).toEqual([]);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("ko.wikipedia.org");
  });
});
