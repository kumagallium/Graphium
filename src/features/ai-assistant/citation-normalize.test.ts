import { describe, it, expect } from "vitest";
import { normalizeWikiCitations, appendKnowledgeReferenced } from "./citation-normalize";

// Retriever が注入する wikiContext を模した fixture。
// knowledge セクションは `[#N | "title"]` ヘッダー、index は `- **title**` 形式。
const WIKI_CONTEXT = `The following is the user's accumulated knowledge.

CITATION FORMAT (STRICT): ...

<wiki-index>
- **インデックスだけのページ** (concept)
- **急冷速度を上げると Al6Ge5 が優先的に形成される** (claim)
</wiki-index>

<knowledge>
[#1 | "急冷速度を上げると Al6Ge5 が優先的に形成される"]
液体急冷で Al6Ge5 が優先析出する。

[#2 | "Ti 置換は Al3V の熱伝導率を下げる"]
Ti を置換すると格子散乱が増える。
</knowledge>`;

describe("normalizeWikiCitations", () => {
  it("番号引用 [#1] を [Source: \"title\"] に変換する", () => {
    const { message, sources } = normalizeWikiCitations(
      "急冷で主相が得られます [#1]。",
      WIKI_CONTEXT,
    );
    expect(message).toBe('急冷で主相が得られます [Source: "急冷速度を上げると Al6Ge5 が優先的に形成される"]。');
    expect(sources).toEqual(["急冷速度を上げると Al6Ge5 が優先的に形成される"]);
  });

  it("# を落とした番号引用 [2] も変換する", () => {
    const { message, sources } = normalizeWikiCitations(
      "Ti 置換が効きます [2]。",
      WIKI_CONTEXT,
    );
    expect(message).toBe('Ti 置換が効きます [Source: "Ti 置換は Al3V の熱伝導率を下げる"]。');
    expect(sources).toEqual(["Ti 置換は Al3V の熱伝導率を下げる"]);
  });

  it("範囲外の番号 [9] は引用に変換せずそのまま残す", () => {
    const { message, sources } = normalizeWikiCitations(
      "手順は 3 段階 [9] あります。",
      WIKI_CONTEXT,
    );
    expect(message).toBe("手順は 3 段階 [9] あります。");
    expect(sources).toEqual([]);
  });

  it("全角【Source: \"title\"】を半角 [Source] に揃える", () => {
    const { message, sources } = normalizeWikiCitations(
      '急冷が効きます【Source: "急冷速度を上げると Al6Ge5 が優先的に形成される"】。',
      WIKI_CONTEXT,
    );
    expect(message).toContain('[Source: "急冷速度を上げると Al6Ge5 が優先的に形成される"]');
    expect(message).not.toContain("【");
    expect(sources).toEqual(["急冷速度を上げると Al6Ge5 が優先的に形成される"]);
  });

  it("言い換え／@ 付きタイトルを prefix match で正式タイトルに復元する", () => {
    const { sources } = normalizeWikiCitations(
      '効果あり [Source: "@急冷速度を上げると Al6Ge5"]。',
      WIKI_CONTEXT,
    );
    expect(sources).toEqual(["急冷速度を上げると Al6Ge5 が優先的に形成される"]);
  });

  it("存在しないタイトル（hallucination）の引用は本文から除去する", () => {
    const { message, sources } = normalizeWikiCitations(
      '断言します [Source: "存在しない捏造ページ"]。',
      WIKI_CONTEXT,
    );
    expect(message).toBe("断言します 。");
    expect(sources).toEqual([]);
  });

  it("<wiki-index> だけにあるタイトルの引用も解決する", () => {
    const { sources } = normalizeWikiCitations(
      '関連します [Source: "インデックスだけのページ"]。',
      WIKI_CONTEXT,
    );
    expect(sources).toEqual(["インデックスだけのページ"]);
  });

  it("candidateTitles は番号付きセクションのタイトルを返す", () => {
    const { candidateTitles } = normalizeWikiCitations("引用なし。", WIKI_CONTEXT);
    expect(candidateTitles).toEqual([
      "急冷速度を上げると Al6Ge5 が優先的に形成される",
      "Ti 置換は Al3V の熱伝導率を下げる",
    ]);
  });

  it("同じソースを複数回引用しても sources は重複しない", () => {
    const { sources } = normalizeWikiCitations(
      "A [#1] であり B [#1] でもある。",
      WIKI_CONTEXT,
    );
    expect(sources).toEqual(["急冷速度を上げると Al6Ge5 が優先的に形成される"]);
  });
});

describe("appendKnowledgeReferenced", () => {
  it("sources があれば箇条書きの Knowledge referenced を付ける", () => {
    const out = appendKnowledgeReferenced("本文", ["タイトルA", "タイトルB"]);
    expect(out).toBe(
      '本文\n\n---\n**Knowledge referenced:**\n  - [Source: "タイトルA"]\n  - [Source: "タイトルB"]',
    );
  });

  it("sources が空ならプレースホルダを付ける", () => {
    const out = appendKnowledgeReferenced("本文", []);
    expect(out).toBe("本文\n\n---\n📎 *Knowledge referenced*");
  });
});
