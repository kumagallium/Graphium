// lintWikis の進み具合: progressId を添えて要求し、走っている間は /lint/progress/:id を数秒ごとに
// 問い合わせて onProgress に渡す。終わったら問い合わせをやめる。クイック点検では問い合わせない
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./wiki-log", () => ({ wikiLog: { formatRecentForLLM: async () => "" } }));

const { lintWikis, LINT_PROGRESS_POLL_MS } = await import("./wiki-service");

const report = { issues: [], summary: { total: 0 }, analyzedAt: "2026-01-01T00:00:00Z" };
let releaseLint: () => void = () => {};
const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith("/lint")) {
      await new Promise<void>((resolve) => { releaseLint = resolve; });
      return new Response(JSON.stringify(report), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/lint/progress/")) {
      return new Response(JSON.stringify({ done: 1, total: 4 }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error("unexpected " + url);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("lintWikis の進み具合", () => {
  it("フル点検では progressId を添え、走っている間だけ進み具合を問い合わせる", async () => {
    const onProgress = vi.fn();
    const pending = lintWikis([], "ja", false, undefined, onProgress);
    await vi.advanceTimersByTimeAsync(LINT_PROGRESS_POLL_MS * 2 + 10);
    const lintCall = fetchMock.mock.calls.find(([url]) => (url as string).endsWith("/lint"))!;
    const sent = JSON.parse((lintCall[1] as RequestInit).body as string);
    expect(sent.progressId).toMatch(/^[A-Za-z0-9_-]+$/);
    const polls = fetchMock.mock.calls.filter(([url]) => (url as string).includes(`/lint/progress/${sent.progressId}`));
    expect(polls.length).toBe(2);
    expect(onProgress).toHaveBeenLastCalledWith({ done: 1, total: 4 });
    releaseLint();
    await expect(pending).resolves.toEqual(report);
    const before = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(LINT_PROGRESS_POLL_MS * 3);
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it("クイック点検や onProgress 無しでは progressId を付けず、問い合わせもしない", async () => {
    const pending = lintWikis([], "ja", true, undefined, vi.fn());
    await vi.advanceTimersByTimeAsync(LINT_PROGRESS_POLL_MS * 2 + 10);
    releaseLint();
    await pending;
    expect(fetchMock.mock.calls.length).toBe(1);
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).progressId).toBeUndefined();
  });
});
