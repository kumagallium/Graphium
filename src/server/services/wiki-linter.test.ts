// wiki-linter の Tier 1 unit test（LLM 呼び出しなし）
//
// detectLocalIssues の orphan topic 検出（メンバー知見 0 件の話題ページ）を検証する。

import { describe, it, expect } from "vitest";
import { detectLocalIssues, detectAutoArchivable, detectMissingSourceIssues, parseLinterOutput, buildLinterUserMessage, buildLinterSystemPrompt, type WikiSnapshot } from "./wiki-linter.ts";

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

  it("answer（回答ページ）も derivedFromClaims/derivedFromNotes が両方空なら orphan として検出する", () => {
    const issues = detectLocalIssues([
      base({ id: "answer-1", title: "孤立した回答", kind: "answer", derivedFromClaims: [], derivedFromNotes: [] }),
    ]);
    expect(issues.some((i) => i.type === "orphan" && i.affectedWikiIds.includes("answer-1"))).toBe(true);
  });

  it("answer で資料（derivedFromNotes）を持てば orphan にしない", () => {
    const issues = detectLocalIssues([
      base({ id: "answer-2", title: "回答", kind: "answer", derivedFromClaims: [], derivedFromNotes: ["note-a"] }),
    ]);
    expect(issues.some((i) => i.type === "orphan" && i.affectedWikiIds.includes("answer-2"))).toBe(false);
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

describe("detectAutoArchivable - 新形式トピックの資料全滅（sources-gone）", () => {
  const topic = (id: string, derivedFromNotes: string[]) => ({
    id, title: id, kind: "topic" as const, derivedFromNotes, relatedClaims: [],
    derivedFromClaims: [] as string[],
    bodyPreview: "", modifiedAt: "2026-09-16T00:00:00.000Z",
  });

  it("資料が全てノート id で、全部ゴミ箱・未検出なら sources-gone として検出する", () => {
    const wikis = [topic("t1", ["note-gone-a", "note-gone-b"])];
    const out = detectAutoArchivable(wikis, new Set(["note-alive"]));
    expect(out).toEqual([{ id: "t1", title: "t1", kind: "topic", reason: "sources-gone" }]);
  });

  it("資料に 1 件でも有効なノートがあれば検出しない", () => {
    const wikis = [topic("t1", ["note-gone", "note-alive"])];
    expect(detectAutoArchivable(wikis, new Set(["note-alive"]))).toEqual([]);
  });

  it("外部プレフィックス付き資料（pdf:/url: 等）が 1 つでも混ざれば検出しない", () => {
    const wikis = [topic("t1", ["note-gone", "pdf:abc"])];
    expect(detectAutoArchivable(wikis, new Set())).toEqual([]);
  });

  it("validNoteIds が空（索引未読込）なら判定しない", () => {
    const wikis = [topic("t1", ["note-gone"])];
    expect(detectAutoArchivable(wikis, new Set())).toEqual([]);
  });

  it("旧形式トピック（derivedFromClaims にメンバーあり）は対象外", () => {
    const wikis = [{ ...topic("t1", ["note-gone"]), derivedFromClaims: ["claim-a"] }];
    expect(detectAutoArchivable(wikis, new Set(["note-alive"]))).toEqual([]);
  });

  it("answer（回答ページ）も同じ規則で sources-gone を検出し、kind を answer のまま返す", () => {
    const wikis = [{ ...topic("a1", ["note-gone-a", "note-gone-b"]), kind: "answer" as const }];
    const out = detectAutoArchivable(wikis, new Set(["note-alive"]));
    expect(out).toEqual([{ id: "a1", title: "a1", kind: "answer", reason: "sources-gone" }]);
  });
});

describe("detectMissingSourceIssues - 新形式トピックの資料一部欠落", () => {
  const topic = (id: string, derivedFromNotes: string[], derivedFromClaims: string[] = []) => ({
    id, title: id, kind: "topic" as const, derivedFromNotes, relatedClaims: [],
    derivedFromClaims,
    bodyPreview: "", modifiedAt: "2026-09-16T00:00:00.000Z",
  });

  it("資料の一部だけがゴミ箱・未検出なら warning issue を作る", () => {
    const wikis = [topic("t1", ["note-alive", "note-gone"])];
    const issues = detectMissingSourceIssues(wikis, new Set(["note-alive"]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ type: "missing-source", severity: "warning", affectedWikiIds: ["t1"] });
  });

  it("資料が全滅（0 件有効）なら対象外（sources-gone 側の役割）", () => {
    const wikis = [topic("t1", ["note-gone-a", "note-gone-b"])];
    expect(detectMissingSourceIssues(wikis, new Set(["note-alive"]))).toEqual([]);
  });

  it("資料が全部有効なら issue を作らない", () => {
    const wikis = [topic("t1", ["note-a", "note-b"])];
    expect(detectMissingSourceIssues(wikis, new Set(["note-a", "note-b"]))).toEqual([]);
  });

  it("外部プレフィックス付き資料は判定対象から除く（残り全部有効なら issue なし）", () => {
    const wikis = [topic("t1", ["note-a", "pdf:abc"])];
    expect(detectMissingSourceIssues(wikis, new Set(["note-a"]))).toEqual([]);
  });

  it("旧形式トピック（derivedFromClaims にメンバーあり）は対象外", () => {
    const wikis = [topic("t1", ["note-gone", "note-alive"], ["claim-a"])];
    expect(detectMissingSourceIssues(wikis, new Set(["note-alive"]))).toEqual([]);
  });

  it("validNoteIds が空（索引未読込）なら判定しない", () => {
    const wikis = [topic("t1", ["note-gone", "note-alive"])];
    expect(detectMissingSourceIssues(wikis, new Set())).toEqual([]);
  });

  it("answer（回答ページ）も同じ規則で資料一部欠落を検出する", () => {
    const wikis = [{ ...topic("a1", ["note-alive", "note-gone"]), kind: "answer" as const }];
    const issues = detectMissingSourceIssues(wikis, new Set(["note-alive"]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ type: "missing-source", severity: "warning", affectedWikiIds: ["a1"] });
  });
});

describe("parseLinterOutput - questions（次に調べること）", () => {
  it("questions を読み取る", () => {
    const text = JSON.stringify({
      issues: [],
      questions: [
        {
          question: "Ti 置換量を変えた系の熱伝導率はどうなるか",
          why: "「Al5Co2 の熱電特性」の記述に Ti 置換の効果が抜けている",
          affectedWikiIds: ["w1"],
          needs: "external",
          lookFor: "Ti 置換量を振った熱伝導率の測定",
        },
      ],
    });
    const { issues, questions } = parseLinterOutput(text, new Set(["w1"]));
    expect(issues).toEqual([]);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      question: "Ti 置換量を変えた系の熱伝導率はどうなるか",
      needs: "external",
      lookFor: "Ti 置換量を振った熱伝導率の測定",
      affectedWikiIds: ["w1"],
    });
  });

  it("questions が無い出力でも既存どおり動く（空配列で返る）", () => {
    const text = JSON.stringify({ issues: [] });
    const { issues, questions } = parseLinterOutput(text);
    expect(issues).toEqual([]);
    expect(questions).toEqual([]);
  });

  it("question/why を欠いた壊れた要素は捨てる", () => {
    const text = JSON.stringify({
      issues: [],
      questions: [
        { question: "問いだけあって why が無い", affectedWikiIds: [] },
        { question: "ちゃんとした問い", why: "理由", affectedWikiIds: [] },
      ],
    });
    const { questions } = parseLinterOutput(text);
    expect(questions).toHaveLength(1);
    expect(questions[0].question).toBe("ちゃんとした問い");
  });

  it("affectedWikiIds に実在しない id があればその id だけ落とす（validWikiIds 指定時）", () => {
    const text = JSON.stringify({
      issues: [],
      questions: [
        {
          question: "q",
          why: "w",
          affectedWikiIds: ["real-id", "hallucinated-id"],
          needs: "internal",
        },
      ],
    });
    const { questions } = parseLinterOutput(text, new Set(["real-id"]));
    expect(questions[0].affectedWikiIds).toEqual(["real-id"]);
  });

  it("needs が external 以外は internal 扱い・lookFor は internal では捨てる", () => {
    const text = JSON.stringify({
      issues: [],
      questions: [{ question: "q", why: "w", affectedWikiIds: [], needs: "internal", lookFor: "無視されるはず" }],
    });
    const { questions } = parseLinterOutput(text);
    expect(questions[0].needs).toBe("internal");
    expect(questions[0].lookFor).toBeUndefined();
  });
});

describe("buildLinterUserMessage - コンテキスト長対策（構造で減らす）", () => {
  it("kind === 'summary' のページを渡さない", () => {
    const wikis = [
      base({ id: "s1", kind: "summary", title: "旧・要約ページ", bodyPreview: "むかしの要約" }),
      base({ id: "t1", kind: "topic", title: "トピック", bodyPreview: "トピックの中身" }),
    ];
    const { text } = buildLinterUserMessage(wikis);
    expect(text).not.toContain("旧・要約ページ");
    expect(text).not.toContain("むかしの要約");
    expect(text).toContain("トピック");
  });

  it("knowledge（claim）は Preview 行を出さず、topic には出す", () => {
    const wikis = [
      base({ id: "c1", kind: "claim", title: "知見のタイトルは命題そのもの", bodyPreview: "本文プレビューは重複するので出ない" }),
      base({ id: "t1", kind: "topic", title: "トピック", bodyPreview: "トピックのプレビューは出る" }),
    ];
    const { text } = buildLinterUserMessage(wikis);
    expect(text).not.toContain("本文プレビューは重複するので出ない");
    expect(text).toContain("Preview: トピックのプレビューは出る");
  });

  it("冒頭の件数は summary を除いた実際に渡した件数になる", () => {
    const wikis = [
      base({ id: "s1", kind: "summary", title: "旧・要約" }),
      base({ id: "t1", kind: "topic", title: "トピック1" }),
      base({ id: "t2", kind: "topic", title: "トピック2" }),
    ];
    const { text } = buildLinterUserMessage(wikis);
    expect(text).toContain("Analyze the following 2 Wiki documents");
  });
});

describe("buildLinterUserMessage - recentLog（棚卸し D2）", () => {
  it("recentLog を渡すと末尾に節が付く", () => {
    const wikis = [base({ id: "t1", kind: "topic", title: "トピック" })];
    const { text } = buildLinterUserMessage(wikis, "[2026-09-20 00:00] ingest: foo");
    expect(text).toContain("## Recent activity (newest first)");
    expect(text).toContain("[2026-09-20 00:00] ingest: foo");
  });

  it("recentLog を渡さないと従来どおり（節が付かない）", () => {
    const wikis = [base({ id: "t1", kind: "topic", title: "トピック" })];
    const { text } = buildLinterUserMessage(wikis);
    expect(text).not.toContain("## Recent activity");
  });
});

describe("buildLinterUserMessage - #N 参照番号と日時の短縮（実データ規模のトークン対策）", () => {
  it("見出しは UUID ではなく渡した順の #N になり、numberToId が同じ順序で対応表を持つ", () => {
    const wikis = [
      base({ id: "uuid-a", kind: "topic", title: "トピックA" }),
      base({ id: "uuid-b", kind: "topic", title: "トピックB" }),
    ];
    const { text, numberToId } = buildLinterUserMessage(wikis);
    expect(text).toContain("## #1 [topic] トピックA");
    expect(text).toContain("## #2 [topic] トピックB");
    expect(text).not.toContain("uuid-a");
    expect(text).not.toContain("uuid-b");
    expect(text).not.toContain("(id:");
    expect(numberToId.get("1")).toBe("uuid-a");
    expect(numberToId.get("2")).toBe("uuid-b");
  });

  it("入力の順序を変えても numberToId は本文の見出し順とずれない", () => {
    const wikisReversed = [
      base({ id: "uuid-b", kind: "topic", title: "トピックB" }),
      base({ id: "uuid-a", kind: "topic", title: "トピックA" }),
    ];
    const { text, numberToId } = buildLinterUserMessage(wikisReversed);
    expect(text).toContain("## #1 [topic] トピックB");
    expect(text).toContain("## #2 [topic] トピックA");
    expect(numberToId.get("1")).toBe("uuid-b");
    expect(numberToId.get("2")).toBe("uuid-a");
  });

  it("Last updated は日付だけになる（時刻を出さない）", () => {
    const wikis = [base({ id: "t1", kind: "topic", title: "トピック", modifiedAt: "2026-09-24T12:34:56.000Z" })];
    const { text } = buildLinterUserMessage(wikis);
    expect(text).toContain("Last updated: 2026-09-24");
    expect(text).not.toContain("12:34:56");
  });

  it("Last ingested は更新日と同じ日なら省略する", () => {
    const wikis = [
      base({
        id: "t1",
        kind: "topic",
        title: "トピック",
        modifiedAt: "2026-09-24T00:00:00.000Z",
        lastIngestedAt: "2026-09-24T09:00:00.000Z",
      }),
    ];
    const { text } = buildLinterUserMessage(wikis);
    expect(text).not.toContain("Last ingested");
  });

  it("Last ingested は更新日と日付が違うときだけ出す", () => {
    const wikis = [
      base({
        id: "t1",
        kind: "topic",
        title: "トピック",
        modifiedAt: "2026-09-24T00:00:00.000Z",
        lastIngestedAt: "2026-09-20T09:00:00.000Z",
      }),
    ];
    const { text } = buildLinterUserMessage(wikis);
    expect(text).toContain("Last ingested: 2026-09-20");
  });
});

describe("buildLinterSystemPrompt - 出力言語の指示（点検結果が英語になる不具合の回帰防止）", () => {
  it("ja のとき日本語で出力する指示を含み、英語出力の指示は含まない", () => {
    const prompt = buildLinterSystemPrompt("ja");
    expect(prompt).toContain("Output in: Japanese");
    expect(prompt).not.toContain("Output in: English");
  });

  it("en のとき英語で出力する指示を含み、日本語出力の指示は含まない", () => {
    const prompt = buildLinterSystemPrompt("en");
    expect(prompt).toContain("Output in: English");
    expect(prompt).not.toContain("Output in: Japanese");
  });

  it("questions を必ず出力に含める指示を含む", () => {
    const prompt = buildLinterSystemPrompt("ja");
    expect(prompt).toMatch(/questions.*MUST always be present/);
  });
});

describe("parseLinterOutput - id 欄にタイトルが紛れ込んだ場合の引き直し（実モデル回帰）", () => {
  const validWikiIds = new Set(["id-a", "id-b", "id-c"]);
  const titleToId = new Map([
    ["タイトルA", "id-a"],
    ["タイトルB", "id-b"],
    ["タイトルC", "id-c"],
  ]);

  it("affectedWikiIds にタイトルが入っていれば id に引き直す", () => {
    const text = JSON.stringify({
      issues: [
        {
          type: "gap",
          severity: "info",
          title: "t",
          description: "d",
          affectedWikiIds: ["タイトルA", "id-b"],
          suggestion: "s",
        },
      ],
    });
    const { issues } = parseLinterOutput(text, validWikiIds, titleToId);
    expect(issues[0].affectedWikiIds).toEqual(["id-a", "id-b"]);
  });

  it("id にもタイトルにも一致しない要素は落とす", () => {
    const text = JSON.stringify({
      issues: [
        {
          type: "gap",
          severity: "info",
          title: "t",
          description: "d",
          affectedWikiIds: ["id-a", "存在しないタイトル", "hallucinated-id"],
          suggestion: "s",
        },
      ],
    });
    const { issues } = parseLinterOutput(text, validWikiIds, titleToId);
    expect(issues[0].affectedWikiIds).toEqual(["id-a"]);
  });

  it("redundant の keepId/absorbId がタイトルで来ても引き直し、affectedWikiIds にも反映する", () => {
    const text = JSON.stringify({
      issues: [
        {
          type: "redundant",
          severity: "warning",
          title: "t",
          description: "d",
          affectedWikiIds: ["タイトルA", "タイトルB"],
          suggestion: "s",
          recommendedAction: { type: "merge", keepId: "タイトルA", absorbId: "タイトルB", reason: "r" },
        },
      ],
    });
    const { issues } = parseLinterOutput(text, validWikiIds, titleToId);
    expect(issues[0].recommendedAction).toMatchObject({ keepId: "id-a", absorbId: "id-b" });
  });

  it("redundant の keepId が id にもタイトルにも引き直せないときは issue ごと落とす", () => {
    const text = JSON.stringify({
      issues: [
        {
          type: "redundant",
          severity: "warning",
          title: "t",
          description: "d",
          affectedWikiIds: ["id-a", "id-b"],
          suggestion: "s",
          recommendedAction: { type: "merge", keepId: "存在しないタイトル", absorbId: "id-b", reason: "r" },
        },
      ],
    });
    const { issues } = parseLinterOutput(text, validWikiIds, titleToId);
    expect(issues).toHaveLength(0);
  });

  it("questions の affectedWikiIds も同じ規則で引き直す", () => {
    const text = JSON.stringify({
      issues: [],
      questions: [
        { question: "q", why: "w", affectedWikiIds: ["タイトルC", "存在しない"], needs: "internal" },
      ],
    });
    const { questions } = parseLinterOutput(text, validWikiIds, titleToId);
    expect(questions[0].affectedWikiIds).toEqual(["id-c"]);
  });

  it("validWikiIds を渡さないときは従来どおり素通しする（後方互換）", () => {
    const text = JSON.stringify({
      issues: [
        { type: "gap", severity: "info", title: "t", description: "d", affectedWikiIds: ["タイトルA"], suggestion: "s" },
      ],
    });
    const { issues } = parseLinterOutput(text);
    expect(issues[0].affectedWikiIds).toEqual(["タイトルA"]);
  });
});

describe("parseLinterOutput - #N 参照番号の引き直し（実データ規模のトークン対策）", () => {
  const validWikiIds = new Set(["id-a", "id-b"]);
  const titleToId = new Map([["タイトルA", "id-a"]]);
  const numberToId = new Map([["1", "id-a"], ["2", "id-b"]]);

  it("#12 形式（# 付き数字）を id に引き直す", () => {
    const text = JSON.stringify({
      issues: [{ type: "gap", severity: "info", title: "t", description: "d", affectedWikiIds: ["#1"], suggestion: "s" }],
    });
    const { issues } = parseLinterOutput(text, validWikiIds, titleToId, numberToId);
    expect(issues[0].affectedWikiIds).toEqual(["id-a"]);
  });

  it("12 形式（# 無しの数字のみ）を id に引き直す", () => {
    const text = JSON.stringify({
      issues: [{ type: "gap", severity: "info", title: "t", description: "d", affectedWikiIds: ["2"], suggestion: "s" }],
    });
    const { issues } = parseLinterOutput(text, validWikiIds, titleToId, numberToId);
    expect(issues[0].affectedWikiIds).toEqual(["id-b"]);
  });

  it("実 id（UUID 等）はそのまま通す", () => {
    const text = JSON.stringify({
      issues: [{ type: "gap", severity: "info", title: "t", description: "d", affectedWikiIds: ["id-a"], suggestion: "s" }],
    });
    const { issues } = parseLinterOutput(text, validWikiIds, titleToId, numberToId);
    expect(issues[0].affectedWikiIds).toEqual(["id-a"]);
  });

  it("タイトルも従来どおり id に引き直す", () => {
    const text = JSON.stringify({
      issues: [{ type: "gap", severity: "info", title: "t", description: "d", affectedWikiIds: ["タイトルA"], suggestion: "s" }],
    });
    const { issues } = parseLinterOutput(text, validWikiIds, titleToId, numberToId);
    expect(issues[0].affectedWikiIds).toEqual(["id-a"]);
  });

  it("存在しない番号（範囲外）は落とす", () => {
    const text = JSON.stringify({
      issues: [{ type: "gap", severity: "info", title: "t", description: "d", affectedWikiIds: ["#99"], suggestion: "s" }],
    });
    const { issues } = parseLinterOutput(text, validWikiIds, titleToId, numberToId);
    expect(issues[0].affectedWikiIds).toEqual([]);
  });
});
