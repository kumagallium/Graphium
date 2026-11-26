// @vitest-environment jsdom
//
// 資料の振り分け（route-topics）と見取り図（survey-source）の、1 回あたりの時間切れと
// 1 回だけの再試行を確かめる。fetch をモックし、timeoutMs は短い値にして実時間で動かす。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeTopicsForSource, surveySourceForWindows } from "./wiki-service";

const SRC = { id: "s1", title: "t", text: "text" };
const EXISTING = [{ id: "topic-1", title: "既存" }];

/** signal が abort されるまで解決せず、abort で AbortError を reject する fetch */
function hang(init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(new DOMException("aborted", "AbortError"));
    });
  });
}

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe("振り分けと見取り図: 時間切れと再試行", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("振り分け: 1 回目が時間切れでも 2 回目が成功すれば結果を返す", async () => {
    fetchMock
      .mockImplementationOnce((_u, init) => hang(init))
      .mockImplementationOnce(async () => okResponse({ update: ["topic-1", "ghost"], create: ["新規"] }));
    const out = await routeTopicsForSource(SRC, EXISTING, "ja", undefined, undefined, undefined, 20);
    expect(out.update).toEqual(["topic-1"]);
    expect(out.create).toEqual(["新規"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("振り分け: 2 回とも時間切れなら AI_CALL_TIMEOUT を投げる（3 回目は送らない）", async () => {
    fetchMock.mockImplementation((_u, init) => hang(init));
    await expect(routeTopicsForSource(SRC, EXISTING, "ja", undefined, undefined, undefined, 20))
      .rejects.toMatchObject({ message: "route-topics timed out", code: "AI_CALL_TIMEOUT" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("振り分け: 本文の読み取りが止まった場合も時間切れとしてやり直す", async () => {
    const stuckBody = (init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: () => hang(init) as unknown as Promise<unknown>,
    }) as unknown as Response;
    fetchMock
      .mockImplementationOnce(async (_u, init) => stuckBody(init))
      .mockImplementationOnce(async () => okResponse({ update: [], create: ["新規"] }));
    const out = await routeTopicsForSource(SRC, EXISTING, "ja", undefined, undefined, undefined, 20);
    expect(out.create).toEqual(["新規"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("振り分け: 外の signal で中断したら再試行せず、中断として投げる", async () => {
    fetchMock.mockImplementation((_u, init) => hang(init));
    const ctrl = new AbortController();
    const p = routeTopicsForSource(SRC, EXISTING, "ja", undefined, ctrl.signal, undefined, 5000);
    setTimeout(() => ctrl.abort(), 10);
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("振り分け: 時間切れ以外の失敗はやり直さない", async () => {
    fetchMock.mockImplementation(async () => { throw new TypeError("fetch failed"); });
    await expect(routeTopicsForSource(SRC, EXISTING, "ja", undefined, undefined, undefined, 5000)).rejects.toThrow("fetch failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("見取り図: 1 回目が時間切れでも 2 回目が成功すれば返す", async () => {
    fetchMock
      .mockImplementationOnce((_u, init) => hang(init))
      .mockImplementationOnce(async () => okResponse({ survey: "見取り図" }));
    expect(await surveySourceForWindows(SRC, "ja", undefined, undefined, 20)).toBe("見取り図");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("見取り図: 2 回とも時間切れなら null（見取り図なしで続行）", async () => {
    fetchMock.mockImplementation((_u, init) => hang(init));
    expect(await surveySourceForWindows(SRC, "ja", undefined, undefined, 20)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
