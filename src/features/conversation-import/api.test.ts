// 会話の記録を読む口の呼び出しのテスト（fetch を差し替える）

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchConversationMaterials, fetchConversationWorkdirs } from "./api";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(impl: () => Promise<Response> | Response) {
  const f = vi.fn(async () => impl());
  vi.stubGlobal("fetch", f);
  return f;
}

describe("fetchConversationWorkdirs", () => {
  it("API の宛先は /api/conversations/…（apiBase は /api までを含むので、/api を重ねない）", async () => {
    const f = stubFetch(() => new Response(JSON.stringify({ searchedPath: "~/.claude/projects", workdirs: [] }), { status: 200 }));
    await fetchConversationWorkdirs();
    expect((f.mock.calls[0] as unknown[])[0]).toBe("/api/conversations/claude-code/workdirs");
  });

  it("404 は unavailable", async () => {
    stubFetch(() => new Response(JSON.stringify({ code: "NOT_AVAILABLE" }), { status: 404 }));
    expect(await fetchConversationWorkdirs()).toEqual({ kind: "unavailable" });
  });

  it("fetch が投げたら unavailable（ブラウザだけの版）", async () => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await fetchConversationWorkdirs()).toEqual({ kind: "unavailable" });
  });

  it("デスクトップ版で fetch が投げたら error（打ち切りを「使えない」と取り違えない）", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    const f = stubFetch(() => Promise.reject(new TypeError("Load failed")));
    expect(await fetchConversationWorkdirs()).toEqual({ kind: "error" });
    expect((f.mock.calls[0] as unknown[])[0]).toBe("http://127.0.0.1:3001/api/conversations/claude-code/workdirs");
  });

  it("500 は error", async () => {
    stubFetch(() => new Response("{}", { status: 500 }));
    expect(await fetchConversationWorkdirs()).toEqual({ kind: "error" });
  });

  it("200 は ok", async () => {
    const body = { searchedPath: "~/.claude/projects", workdirs: [] };
    stubFetch(() => new Response(JSON.stringify(body), { status: 200 }));
    expect(await fetchConversationWorkdirs()).toEqual({ kind: "ok", ...body });
  });
});

describe("fetchConversationMaterials", () => {
  it("失敗は投げる", async () => {
    stubFetch(() => new Response("{}", { status: 500 }));
    await expect(fetchConversationMaterials([])).rejects.toThrow();
  });

  it("200 は結果を返す", async () => {
    stubFetch(() => new Response(JSON.stringify({ materials: [], failed: 2 }), { status: 200 }));
    expect(await fetchConversationMaterials([{ dirName: "d", fileName: "f.jsonl" }])).toEqual({
      materials: [],
      failed: 2,
    });
  });
});
