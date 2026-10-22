// フル点検を窓に分ける（buildLinterWindowMessages）の回帰ガード
//
// ナレッジが大きいと全ページを 1 回で送れず、128K のモデルでは毎回失敗していた。
// 窓に分けても「全ページをちょうど 1 回ずつ見る」「番号は全体で通し」「トピックとその知見は
// 同じ窓」「窓が 1 つなら従来と同じ文面」を守ることを見る。

import { describe, expect, it } from "vitest";
import { estimateTokens } from "../../lib/context-estimate.ts";
import {
  buildLinterUserMessage,
  buildLinterWindowMessages,
  mergeWindowIssues,
  mergeWindowQuestions,
  type LintIssue,
  type WikiSnapshot,
} from "./wiki-linter.ts";

const page = (overrides: Partial<WikiSnapshot>): WikiSnapshot => ({
  id: "id",
  title: "title",
  kind: "claim",
  derivedFromNotes: ["n1"],
  relatedClaims: [],
  bodyPreview: "",
  modifiedAt: "2026-10-01T00:00:00Z",
  ...overrides,
});

/** 窓の本文に出てくる #N の一覧 */
const numbersIn = (message: string) => [...message.matchAll(/^## #(\d+) /gm)].map((m) => Number(m[1]));

function vault(topics: number, claimsPerTopic: number, loose: number): WikiSnapshot[] {
  const wikis: WikiSnapshot[] = [];
  for (let t = 0; t < topics; t++) {
    const members: string[] = [];
    for (let c = 0; c < claimsPerTopic; c++) {
      const id = `t${t}-c${c}`;
      members.push(id);
      wikis.push(page({ id, title: `Topic ${t} claim ${c}: proofing dough at 27 degrees for sixty minutes doubles its volume reliably` }));
    }
    wikis.push(page({ id: `t${t}`, kind: "topic", title: `Topic ${t}`, derivedFromClaims: members, bodyPreview: "x".repeat(200) }));
  }
  for (let i = 0; i < loose; i++) wikis.push(page({ id: `loose-${i}`, title: `Loose claim ${i} about oven spring and crust colour` }));
  return wikis;
}

describe("buildLinterWindowMessages", () => {
  it("小さいナレッジは 1 窓で、従来の 1 回送りと同じ文面", () => {
    const wikis = vault(2, 3, 2);
    const { messages } = buildLinterWindowMessages(wikis, "log line");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toBe(buildLinterUserMessage(wikis, "log line").text);
    expect(messages[0].startsWith(`Analyze the following ${wikis.length} Wiki documents for quality issues:`)).toBe(true);
  });

  it("予算を超えると窓に分かれ、全ページをちょうど 1 回ずつ・全体で通しの番号で送る", () => {
    const wikis = vault(40, 20, 100);
    const { messages, numberToId, pageCounts } = buildLinterWindowMessages(wikis, undefined, { budgetTokens: 8_000 });
    expect(messages.length).toBeGreaterThan(1);
    const seen = messages.flatMap(numbersIn);
    expect(seen.length).toBe(wikis.length);
    expect(new Set(seen).size).toBe(wikis.length);
    expect(pageCounts.reduce((a, b) => a + b, 0)).toBe(wikis.length);
    // 番号は全体で通し（窓ごとに振り直さない）
    expect(numberToId.get("1")).toBe(wikis[0].id);
    for (const m of messages) expect(estimateTokens(m)).toBeLessThanOrEqual(8_000);
  });

  it("窓が 2 つ以上なら、全体の何番目の部分かと「ここに無いページもある」を書く", () => {
    const { messages } = buildLinterWindowMessages(vault(40, 20, 0), undefined, { budgetTokens: 8_000 });
    expect(messages[0]).toContain(`This is part 1 of ${messages.length}`);
    expect(messages[0]).toContain("do not report an issue only because a related page is not shown here");
  });

  it("トピックとそのメンバー知見は同じ窓に入る", () => {
    const wikis = vault(40, 20, 0);
    const { messages, numberToId } = buildLinterWindowMessages(wikis, undefined, { budgetTokens: 8_000 });
    const windowOf = new Map<string, number>();
    messages.forEach((m, i) => numbersIn(m).forEach((n) => windowOf.set(numberToId.get(String(n))!, i)));
    for (const topic of wikis.filter((w) => w.kind === "topic")) {
      for (const claimId of topic.derivedFromClaims!) expect(windowOf.get(claimId)).toBe(windowOf.get(topic.id));
    }
  });

  it("1 窓に収まらない大きなトピックは、トピックを先頭にして窓をまたいで分ける", () => {
    const wikis = vault(1, 400, 0);
    const { messages, numberToId } = buildLinterWindowMessages(wikis, undefined, { budgetTokens: 4_000 });
    expect(messages.length).toBeGreaterThan(1);
    expect(numberToId.get(String(numbersIn(messages[0])[0]))).toBe("t0");
    expect(messages.flatMap(numbersIn).length).toBe(wikis.length);
  });

  it("直近ログは、小さければ全部の窓に、大きければ最初の窓にだけ添える", () => {
    const wikis = vault(40, 20, 0);
    const small = buildLinterWindowMessages(wikis, "short log", { budgetTokens: 8_000 });
    expect(small.messages.every((m) => m.includes("## Recent activity"))).toBe(true);
    const big = buildLinterWindowMessages(wikis, "ingested a source. ".repeat(800), { budgetTokens: 8_000 });
    expect(big.messages[0]).toContain("## Recent activity");
    expect(big.messages.slice(1).some((m) => m.includes("## Recent activity"))).toBe(false);
  });

  it("指示文の分を各窓の予算から引く", () => {
    const wikis = vault(40, 20, 0);
    const without = buildLinterWindowMessages(wikis, undefined, { budgetTokens: 8_000 });
    const withReserve = buildLinterWindowMessages(wikis, undefined, { budgetTokens: 8_000, reservedTokens: 3_000 });
    expect(withReserve.messages.length).toBeGreaterThan(without.messages.length);
    for (const m of withReserve.messages) expect(estimateTokens(m)).toBeLessThanOrEqual(5_000);
  });

  it("要約（summary）は窓に分けても送らない", () => {
    const wikis = [...vault(1, 2, 0), page({ id: "s1", kind: "summary", title: "old summary" })];
    const { messages } = buildLinterWindowMessages(wikis);
    expect(messages.join("\n")).not.toContain("old summary");
  });
});

describe("mergeWindowIssues / mergeWindowQuestions", () => {
  const issue = (type: LintIssue["type"], ids: string[], title = "t"): LintIssue => ({
    type, severity: "info", title, description: "d", affectedWikiIds: ids, suggestion: "",
  });

  it("窓の境目で同じページの同じ種類が両側から出たら 1 件にする", () => {
    const merged = mergeWindowIssues([[issue("stale", ["a", "b"])], [issue("stale", ["b", "c"]), issue("gap", ["b"])]]);
    expect(merged.map((i) => i.type)).toEqual(["stale", "gap"]);
  });

  it("同じ文の問いは 1 件にする（大文字小文字・前後の空白は区別しない）", () => {
    const q = (question: string) => ({ question, why: "w", affectedWikiIds: [], needs: "internal" as const });
    const merged = mergeWindowQuestions([[q("What happens at 30C?")], [q(" what happens at 30c? "), q("Another")]]);
    expect(merged.map((x) => x.question)).toEqual(["What happens at 30C?", "Another"]);
  });
});
