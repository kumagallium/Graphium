// wiki-linter の Tier 1 unit test（LLM 呼び出しなし）
//
// detectLocalIssues の orphan topic 検出（メンバー知見 0 件の話題ページ）を検証する。

import { describe, it, expect } from "vitest";
import { detectLocalIssues, detectAutoArchivable, type WikiSnapshot } from "./wiki-linter.ts";

const base = (overrides: Partial<WikiSnapshot>): WikiSnapshot => ({
  id: "id-1",
  title: "title",
  kind: "topic",
  derivedFromNotes: [],
  relatedClaims: [],
  bodyPreview: "",
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

  it("新形式トピック（derivedFromClaims 空・derivedFromNotes に資料 id）は orphan にしない", () => {
    const issues = detectLocalIssues([
      base({ id: "topic-4", title: "新形式話題", derivedFromClaims: [], derivedFromNotes: ["note-a"] }),
    ]);
    expect(issues.some((i) => i.type === "orphan" && i.affectedWikiIds.includes("topic-4"))).toBe(false);
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

describe("detectLocalIssues - redundant topic（正規化タイトル完全一致）", () => {
  it("空白差だけの同名話題を redundant として検出する", () => {
    const issues = detectLocalIssues([
      base({ id: "topic-a", title: "AI3V 格子熱伝導率", derivedFromClaims: ["c1", "c2"] }),
      base({ id: "topic-b", title: "AI3V格子熱伝導率", derivedFromClaims: ["c3"] }),
    ]);
    const redundant = issues.find((i) => i.type === "redundant");
    expect(redundant).toBeDefined();
    expect(redundant?.affectedWikiIds).toEqual(["topic-a", "topic-b"]);
    expect(redundant?.recommendedAction).toMatchObject({ type: "merge", keepId: "topic-a", absorbId: "topic-b" });
  });

  it("メンバー数が多い方を keep に選ぶ", () => {
    const issues = detectLocalIssues([
      base({ id: "topic-a", title: "話題X", derivedFromClaims: ["c1"] }),
      base({ id: "topic-b", title: "話題X", derivedFromClaims: ["c1", "c2", "c3"] }),
    ]);
    const redundant = issues.find((i) => i.type === "redundant");
    expect(redundant?.recommendedAction).toMatchObject({ keepId: "topic-b", absorbId: "topic-a" });
  });

  it("タイトルが異なる話題は redundant にしない", () => {
    const issues = detectLocalIssues([
      base({ id: "topic-a", title: "話題A", derivedFromClaims: ["c1"] }),
      base({ id: "topic-b", title: "話題B", derivedFromClaims: ["c2"] }),
    ]);
    expect(issues.some((i) => i.type === "redundant")).toBe(false);
  });

  it("claim には適用しない（同名 claim が redundant にならない）", () => {
    const issues = detectLocalIssues([
      base({ id: "claim-a", title: "同じ知見", kind: "claim", derivedFromClaims: undefined }),
      base({ id: "claim-b", title: "同じ知見", kind: "claim", derivedFromClaims: undefined }),
    ]);
    expect(issues.some((i) => i.type === "redundant")).toBe(false);
  });
});

describe("detectLocalIssues - contradiction（洞察の conflictsWith を機械的に列挙）", () => {
  it("双方向に conflictsWith を持つ atom ペアを contradiction として 1 件だけ検出する", () => {
    const issues = detectLocalIssues([
      base({ id: "atom-a", title: "Xが増えるとYが増える", kind: "atom", derivedFromClaims: undefined, conflictsWith: ["atom-b"] }),
      base({ id: "atom-b", title: "Xが増えるとYが減る", kind: "atom", derivedFromClaims: undefined, conflictsWith: ["atom-a"] }),
    ]);
    const contradictions = issues.filter((i) => i.type === "contradiction");
    expect(contradictions).toHaveLength(1);
    expect(contradictions[0].affectedWikiIds.sort()).toEqual(["atom-a", "atom-b"]);
    expect(contradictions[0].severity).toBe("error");
  });

  it("conflictsWith が無い atom は contradiction にならない", () => {
    const issues = detectLocalIssues([
      base({ id: "atom-a", title: "A", kind: "atom", derivedFromClaims: undefined }),
      base({ id: "atom-b", title: "B", kind: "atom", derivedFromClaims: undefined }),
    ]);
    expect(issues.some((i) => i.type === "contradiction")).toBe(false);
  });

  it("atom 以外（topic/claim）の conflictsWith は無視する", () => {
    const issues = detectLocalIssues([
      base({ id: "topic-a", title: "A", kind: "topic", derivedFromClaims: ["c1"], conflictsWith: ["topic-b"] }),
      base({ id: "topic-b", title: "B", kind: "topic", derivedFromClaims: ["c2"], conflictsWith: ["topic-a"] }),
    ]);
    expect(issues.some((i) => i.type === "contradiction")).toBe(false);
  });

  it("相手側が見つからない conflictsWith（相互書き込み漏れ）は issue を作らない", () => {
    const issues = detectLocalIssues([
      base({ id: "atom-a", title: "A", kind: "atom", derivedFromClaims: undefined, conflictsWith: ["missing-id"] }),
    ]);
    expect(issues.some((i) => i.type === "contradiction")).toBe(false);
  });
});

describe("detectAutoArchivable - 機械的に判定できる空ナレッジの検出", () => {
  it("メンバー知見が 0 件の topic を検出する", () => {
    const candidates = detectAutoArchivable(
      [base({ id: "topic-1", title: "空話題", kind: "topic", derivedFromClaims: [] })],
      new Set(),
    );
    expect(candidates).toEqual([
      { id: "topic-1", title: "空話題", kind: "topic", reason: "empty-topic" },
    ]);
  });

  it("メンバー知見を持つ topic は検出しない", () => {
    const candidates = detectAutoArchivable(
      [base({ id: "topic-1", title: "話題", kind: "topic", derivedFromClaims: ["claim-a"] })],
      new Set(),
    );
    expect(candidates).toHaveLength(0);
  });

  it("新形式トピック（derivedFromClaims 空・derivedFromNotes に資料 id）は空トピックとみなさない", () => {
    const candidates = detectAutoArchivable(
      [base({ id: "topic-4", title: "新形式話題", kind: "topic", derivedFromClaims: [], derivedFromNotes: ["note-a"] })],
      new Set(),
    );
    expect(candidates).toHaveLength(0);
  });

  it("derivedFromNotes が空の claim は片付けない（来歴が別フィールドにあり得る）", () => {
    const candidates = detectAutoArchivable(
      [base({ id: "claim-1", title: "根無し知見", kind: "claim", derivedFromNotes: [] })],
      new Set(["note-a"]),
    );
    expect(candidates).toEqual([]);
  });

  it("derivedFromNotes が全てゴミ箱・未検出（validNoteIds に無い）の claim を検出する", () => {
    const candidates = detectAutoArchivable(
      [base({ id: "claim-1", title: "知見", kind: "claim", derivedFromNotes: ["note-trashed"] })],
      new Set(["note-a"]),
    );
    expect(candidates.map((c) => c.id)).toEqual(["claim-1"]);
  });

  it("derivedFromNotes に 1 件でも有効なノートがあれば検出しない", () => {
    const candidates = detectAutoArchivable(
      [base({ id: "claim-1", title: "知見", kind: "claim", derivedFromNotes: ["note-trashed", "note-a"] })],
      new Set(["note-a"]),
    );
    expect(candidates).toHaveLength(0);
  });

  it("AI 判断（stale/redundant 相当）の atom/topic 重複は対象外（ここでは検出しない）", () => {
    const candidates = detectAutoArchivable(
      [
        base({ id: "atom-1", title: "洞察", kind: "atom", derivedFromClaims: ["c1"] }),
        base({ id: "topic-1", title: "話題A", kind: "topic", derivedFromClaims: ["c1"] }),
        base({ id: "topic-2", title: "話題a", kind: "topic", derivedFromClaims: ["c2"] }),
      ],
      new Set(["note-a"]),
    );
    expect(candidates).toHaveLength(0);
  });

  it("冪等: 空配列を渡せば空配列を返す（既にアーカイブ済みで wikis に含まれないケースを模す）", () => {
    expect(detectAutoArchivable([], new Set())).toEqual([]);
  });
});

describe("detectAutoArchivable の出どころ判定", () => {
  const claim = (id: string, derivedFromNotes: string[]) => ({
    id, title: id, kind: "claim" as const, derivedFromNotes, relatedClaims: [],
    bodyPreview: "", modifiedAt: "2026-09-16T00:00:00.000Z",
  });

  it("素材（pdf:/url:/chat:）から作った知見は片付けない", () => {
    const wikis = [
      claim("c1", ["pdf:abc"]),
      claim("c2", ["url:https://example.com"]),
      claim("c3", ["chat:xyz"]),
      claim("c4", ["memo:m1"]),
    ];
    expect(detectAutoArchivable(wikis, new Set())).toEqual([]);
  });

  it("出どころが空の知見は片付けない（別フィールドに来歴があり得る）", () => {
    expect(detectAutoArchivable([claim("c1", [])], new Set())).toEqual([]);
  });

  it("ノートと素材が混ざっているときは、ノートが消えていても片付けない", () => {
    const wikis = [claim("c1", ["note-gone", "pdf:abc"])];
    expect(detectAutoArchivable(wikis, new Set())).toEqual([]);
  });

  it("有効なノートが 1 件も無い（索引が未読込の可能性）ときは知見を片付けない", () => {
    const wikis = [claim("c1", ["note-a"])];
    expect(detectAutoArchivable(wikis, new Set())).toEqual([]);
  });

  it("出どころがノートだけで、そのノートが全部消えていれば片付ける", () => {
    const wikis = [claim("c1", ["note-gone"]), claim("c2", ["note-alive"])];
    const out = detectAutoArchivable(wikis, new Set(["note-alive"]));
    expect(out.map((c) => c.id)).toEqual(["c1"]);
    expect(out[0].reason).toBe("orphaned-source");
  });
});
