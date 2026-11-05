import { describe, it, expect, vi } from "vitest";
import {
  buildReconcilerSystemPrompt,
  buildReconcilerUserMessage,
  parseReconcilerOutput,
} from "./wiki-reconciler";
import type { ReconcileInput } from "../../features/wiki/reconcile-types";

const baseInput: ReconcileInput = {
  title: "加水率と食感",
  kind: "topic",
  language: "ja",
  format: "body",
  currentBody: "## 要点\n加水率が高いほど食感は軽くなる。[[source:a1]]",
  disagreements: [
    {
      statement: "加水率が高いほど食感は軽くなる。",
      supporting: [{ sourceId: "a1", sourceTitle: "パンの本", quote: "加水率が高いと軽い" }],
      contradicting: [{ sourceId: "b2", sourceTitle: "製パン論文", quote: "差は無かった", rationale: "測定で差が出ていない" }],
    },
  ],
  conflicts: [{ otherWikiId: "w9", otherTitle: "吸水の限界", summary: "加水率には上限がある" }],
};

describe("buildReconcilerSystemPrompt", () => {
  it("両方の側を書く規則と、決めない規則が入る", () => {
    const p = buildReconcilerSystemPrompt("en", "body", "topic");
    expect(p).toContain("Write both sides");
    expect(p).toContain("Never decide which is correct");
  });
  it("body は [[source:<id>]]、sections は [[タイトル]] の引用規則と見出し規則", () => {
    const body = buildReconcilerSystemPrompt("en", "body", "topic");
    expect(body).toContain("[[source:<id>]]");
    expect(body).toContain("## Disagreements & open questions");
    expect(body).toContain('"body"');
    const sec = buildReconcilerSystemPrompt("en", "sections", "claim");
    expect(sec).toContain("[[source title]]");
    expect(sec).not.toContain("## Disagreements & open questions");
    expect(sec).toContain('"sections"');
  });
  it("ja なら常体の指示、en なら入らない", () => {
    expect(buildReconcilerSystemPrompt("ja", "body", "topic")).toContain("常体");
    expect(buildReconcilerSystemPrompt("en", "body", "topic")).not.toContain("常体");
  });
});

describe("buildReconcilerUserMessage", () => {
  it("タイトル・本文・食い違い・別ページとの矛盾が入る", () => {
    const m = buildReconcilerUserMessage(baseInput);
    expect(m).toContain("加水率と食感");
    expect(m).toContain("[[source:a1]]");
    expect(m).toContain("パンの本 (id: a1)");
    expect(m).toContain("製パン論文 (id: b2)");
    expect(m).toContain("測定で差が出ていない");
    expect(m).toContain("「吸水の限界」");
  });
  it("newer の項目は印つきで出て、conflict は印が付かない", () => {
    const m = buildReconcilerUserMessage({
      ...baseInput,
      conflicts: [
        { otherWikiId: "w1", otherTitle: "新しいページ", summary: "後から書かれた", relation: "newer" },
        { otherWikiId: "w2", otherTitle: "対立ページ", summary: "対立する" },
      ],
    });
    expect(m).toContain("「新しいページ」 (newer page — supersedes this page): 後から書かれた");
    expect(m).toContain("「対立ページ」: 対立する");
    expect(buildReconcilerSystemPrompt("en", "body", "topic")).toContain("supersedes this page's statement");
  });
  it("裏づけの無い文は印つきで出て、出典の引用と理由が付く。食い違いが無ければ併記の指示は出ない", () => {
    const m = buildReconcilerUserMessage({
      ...baseInput,
      disagreements: [],
      conflicts: [],
      unbacked: [
        { statement: "一次発酵は 2 時間。", verdict: "contradicted", sources: [{ sourceId: "a1", sourceTitle: "パンの本", quote: "一次発酵は 1 時間", rationale: "時間が違う" }] },
        { statement: "バターは最後に入れる。", verdict: "not-in-source", sources: [{ sourceId: "a1", sourceTitle: "パンの本", rationale: "記述が無い" }] },
      ],
    });
    expect(m).toContain("# Statements no source backs");
    expect(m).toContain("### Unbacked 1 (contradicted)\nStatement: 一次発酵は 2 時間。");
    expect(m).toContain("quote: 一次発酵は 1 時間");
    expect(m).toContain("rationale: 時間が違う");
    expect(m).toContain("### Unbacked 2 (not in any source)\nStatement: バターは最後に入れる。");
    expect(m).toContain("# Disagreements\n\n(none)");
    expect(m).not.toContain("Write both sides into the page");
    expect(m).toContain("Fix the statements no source backs");
    const sys = buildReconcilerSystemPrompt("ja", "body", "topic");
    expect(sys).toContain("Statements no source backs");
    expect(sys).toContain("Rewrite the statement so it states what the source says");
    expect(sys).toContain("remove the statement together with its citation");
  });
  it("unbacked が無ければ裏づけの節は出ず、併記の指示だけが出る", () => {
    const m = buildReconcilerUserMessage(baseInput);
    expect(m).not.toContain("Statements no source backs");
    expect(m).toContain("Write both sides into the page");
    expect(m).not.toContain("Fix the statements no source backs");
  });
  it("sections は ## 見出しで並べる", () => {
    const m = buildReconcilerUserMessage({
      ...baseInput,
      format: "sections",
      currentSections: [{ heading: "概要", content: "本文" }],
      conflicts: undefined,
    });
    expect(m).toContain("## 概要\n本文");
    expect(m).not.toContain("Conflicts with other pages");
  });
});

describe("parseReconcilerOutput", () => {
  it("body 形式", () => {
    expect(parseReconcilerOutput('{"body":"本文"}', "body")).toEqual({ body: "本文" });
  });
  it("sections 形式", () => {
    expect(parseReconcilerOutput('{"sections":[{"heading":"h","content":"c"}]}', "sections"))
      .toEqual({ sections: [{ heading: "h", content: "c" }] });
  });
  it("```json ラッパーを剥がす", () => {
    expect(parseReconcilerOutput('```json\n{"body":"x"}\n```', "body")).toEqual({ body: "x" });
  });
  it("壊れた JSON や形が違うものは undefined", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(parseReconcilerOutput("not json", "body")).toBeUndefined();
    expect(parseReconcilerOutput('{"sections":[]}', "sections")).toBeUndefined();
    expect(parseReconcilerOutput('{"body":"x"}', "sections")).toBeUndefined();
  });
});
