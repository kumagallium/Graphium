// @vitest-environment jsdom
//
// reviseTopicFromSource の 1 回あたりの時間切れと 1 回だけの再試行を確かめる。
// fetch をモックし、timeoutMs は短い値にして実時間で動かす。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reviseTopicFromSource } from "./wiki-service";

const SRC = { id: "s1", title: "t", text: "text" };

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

describe("reviseTopicFromSource: 時間切れと再試行", () => {
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

  it("1 回目が時間切れでも 2 回目が成功すれば本文を返す", async () => {
    fetchMock
      .mockImplementationOnce((_u, init) => hang(init))
      .mockImplementationOnce(async () => okResponse({ body: "revised" }));
    const out = await reviseTopicFromSource("title", "", SRC, "ja", undefined, undefined, undefined, undefined, undefined, undefined, 20);
    expect(out).toBe("revised");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("2 回とも時間切れなら null を返し onError を呼ぶ", async () => {
    fetchMock.mockImplementation((_u, init) => hang(init));
    const onError = vi.fn();
    const out = await reviseTopicFromSource("title", "", SRC, "ja", undefined, undefined, undefined, undefined, undefined, onError, 20);
    expect(out).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0][0] as Error).message).toBe("revise-topic timed out");
  });

  it("外の signal で中断したら再試行せず null", async () => {
    fetchMock.mockImplementation((_u, init) => hang(init));
    const ctrl = new AbortController();
    const p = reviseTopicFromSource("title", "", SRC, "ja", undefined, undefined, undefined, ctrl.signal, undefined, undefined, 5000);
    setTimeout(() => ctrl.abort(), 10);
    expect(await p).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
