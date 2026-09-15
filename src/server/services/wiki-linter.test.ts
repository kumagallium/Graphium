// wiki-linter の Tier 1 unit test（LLM 呼び出しなし）
//
// detectLocalIssues の orphan topic 検出（メンバー知見 0 件の話題ページ）を検証する。

import { describe, it, expect } from "vitest";
import { detectLocalIssues, type WikiSnapshot } from "./wiki-linter.ts";

const base = (overrides: Partial<WikiSnapshot>): WikiSnapshot => ({
  id: "id-1",
  title: "title",
  kind: "topic",
  derivedFromNotes: [],
  relatedClaims: [],
  bodyPreview: "",
  // stale 判定に引っかからないよう十分新しい日時にしておく
  modifiedAt: new Date().toISOString(),
  ...overrides,
});

describe("detectLocalIssues - orphan topic", () => {
  it("derivedFromClaims が空配列の topic を orphan として検出する", () => {
    const issues = detectLocalIssues([
      base({ id: "topic-1", title: "孤立した話題", derivedFromClaims: [] }),
    ]);
    const orphan = issues.find((i) => i.type === "orphan" && i.affectedWikiIds.includes("topic-1"));
    expect(orphan).toBeDefined();
    expect(orphan?.severity).toBe("warning");
  });

  it("derivedFromClaims が未定義（undefined）の topic も orphan として検出する", () => {
    const issues = detectLocalIssues([
      base({ id: "topic-2", title: "話題", derivedFromClaims: undefined }),
    ]);
    expect(issues.some((i) => i.type === "orphan" && i.affectedWikiIds.includes("topic-2"))).toBe(true);
  });

  it("メンバー知見を持つ topic は orphan にしない", () => {
    const issues = detectLocalIssues([
      base({ id: "topic-3", title: "話題", derivedFromClaims: ["claim-a"] }),
    ]);
    expect(issues.some((i) => i.type === "orphan" && i.affectedWikiIds.includes("topic-3"))).toBe(false);
  });

  it("claim の orphan 判定ロジックには影響しない（topic 追加の副作用がないことの確認）", () => {
    const issues = detectLocalIssues([
      base({
        id: "claim-1",
        title: "孤立 claim",
        kind: "claim",
        derivedFromNotes: [],
        relatedClaims: [],
        derivedFromClaims: undefined,
      }),
    ]);
    expect(issues.some((i) => i.type === "orphan" && i.affectedWikiIds.includes("claim-1"))).toBe(true);
  });
});
