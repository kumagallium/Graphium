// POST /api/wiki/lint を窓に分けたときの route レベルテスト
// AI の呼び出し（runAgentLoop）を差し替え、窓ごとに 1 回呼ぶこと・一部の窓が失敗しても
// できた分を返すこと・一度に扱える量を超えた失敗を見分けることを見る。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const runAgentLoop = vi.fn();
vi.mock("../services/agent-loop.js", async (orig) => ({ ...(await orig<object>()), runAgentLoop: (...a: unknown[]) => runAgentLoop(...a) }));
vi.mock("../services/header-model.js", async (orig) => ({
  ...(await orig<object>()),
  resolveModelConfig: () => ({ name: "test", provider: "openai-compatible", modelId: "gpt-oss-120b", apiKey: "test-key", apiBase: "http://127.0.0.1:1/v1" }),
}));
vi.mock("../services/llm.js", async (orig) => ({ ...(await orig<object>()), createModel: async () => ({}) }));

const { createApp } = await import("../app.js");
const { setDataDir, setServerMode } = await import("../config/models.js");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "graphium-lint-windows-test-"));
  setDataDir(dir);
  setServerMode("node");
  runAgentLoop.mockReset();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** 予算（目安 72,000 トークン）を超える大きさのナレッジ（知見だけ、トピックなし） */
function bigVault() {
  return Array.from({ length: 3000 }, (_, i) => ({
    id: `c${i}`,
    title: `Claim ${i}: proofing dough at 27 degrees for sixty minutes doubles its volume, and a cold retard overnight deepens the flavour noticeably`,
    kind: "claim",
    derivedFromNotes: ["n1"],
    relatedClaims: [],
    bodyPreview: "",
    modifiedAt: "2026-10-01T00:00:00Z",
  }));
}

const ok = (issueRef: string) => ({
  message: JSON.stringify({
    issues: [{ type: "gap", severity: "info", title: `gap ${issueRef}`, description: "d", affectedWikiIds: [issueRef], suggestion: "" }],
    questions: [],
  }),
  toolCalls: [],
  tokenUsage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
  model: "gpt-oss-120b",
});

async function lint(wikis: unknown[]) {
  const app = createApp();
  const res = await app.request("/api/wiki/lint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wikis, language: "en" }),
  });
  return res.json() as Promise<Record<string, any>>;
}

describe("POST /api/wiki/lint（窓に分ける）", () => {
  it("大きいナレッジは窓ごとに 1 回ずつ呼び、結果と使用量をまとめる", async () => {
    runAgentLoop.mockImplementation(async () => ok(`#${runAgentLoop.mock.calls.length}`));
    const body = await lint(bigVault());
    const calls = runAgentLoop.mock.calls.length;
    expect(calls).toBeGreaterThan(1);
    expect(body.lintParts).toEqual({ total: calls, failed: 0 });
    expect(body.lintError).toBeUndefined();
    expect(body.issues.filter((i: { type: string }) => i.type === "gap")).toHaveLength(calls);
    expect(body.tokenUsage.total_tokens).toBe(12 * calls);
  });

  it("一部の窓だけ失敗しても、できた分を返して失敗を伝える", async () => {
    runAgentLoop.mockImplementation(async () => {
      if (runAgentLoop.mock.calls.length === 2) throw new Error("Upstream error 502 Bad Gateway");
      return ok("#1");
    });
    const body = await lint(bigVault());
    expect(body.lintParts.failed).toBe(1);
    expect(body.lintError).toContain("502");
    expect(body.lintErrorKind).toBeUndefined();
    expect(body.issues.some((i: { type: string }) => i.type === "gap")).toBe(true);
  });

  it("全部の窓が一度に扱える量を超えたら、クイックの結果だけにして種類を添える", async () => {
    runAgentLoop.mockRejectedValue(new Error("Input length (84210) exceeds model's maximum context length (32768)."));
    const body = await lint(bigVault());
    expect(body.lintErrorKind).toBe("context");
    expect(body.lintParts.failed).toBe(body.lintParts.total);
    expect(body.issues.some((i: { type: string }) => i.type === "gap")).toBe(false);
  });

  it("小さいナレッジは 1 回だけ呼び、窓の内訳は付けない", async () => {
    runAgentLoop.mockResolvedValue(ok("#1"));
    const body = await lint(bigVault().slice(0, 20));
    expect(runAgentLoop).toHaveBeenCalledTimes(1);
    expect(body.lintParts).toBeUndefined();
  });
});
