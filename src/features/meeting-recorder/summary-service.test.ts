import { afterEach, describe, expect, it, vi } from "vitest";
import { summarizeMeeting } from "./summary-service";

afterEach(() => vi.unstubAllGlobals());

const utterances = [{ id: "p1", track: "system" as const, startMs: 1000, text: "決めましょう" }];

describe("summarizeMeeting", () => {
  it("POST /meeting/summarize に language と utterances を送り、結果を返す", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ decisions: [{ text: "A", sources: ["p1"] }], todos: [], issues: [], model: "m" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await summarizeMeeting({ utterances, language: "ja" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/meeting\/summarize$/);
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.language).toBe("ja");
    expect(body.utterances).toEqual(utterances);
    expect(r.decisions[0].sources).toEqual(["p1"]);
    expect(r.todos).toEqual([]);
  });

  it("失敗レスポンスはサーバーのメッセージで throw する", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "no model" }), { status: 400 })));
    await expect(summarizeMeeting({ utterances, language: "en" })).rejects.toThrow("no model");
  });
});

describe("summarizeMeeting の固定エラー", () => {
  it("413 は入力過大、502 は読み取り失敗の文言", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "x", code: "INPUT_TOO_LARGE" }), { status: 413 })));
    await expect(summarizeMeeting({ utterances, language: "ja" })).rejects.toThrow(/1,500/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "bad" }), { status: 502 })));
    await expect(summarizeMeeting({ utterances, language: "ja" })).rejects.toThrow(/AI|読み取れ|read/);
  });
});
