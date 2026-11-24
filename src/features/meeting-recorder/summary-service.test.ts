import { afterEach, describe, expect, it, vi } from "vitest";
import { summarizeMeeting, chunkSummaryUtterances, SUMMARY_CHUNK_MAX_UTTERANCES } from "./summary-service";

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
    await expect(summarizeMeeting({ utterances, language: "ja" })).rejects.toThrow(/60,000/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "bad" }), { status: 502 })));
    await expect(summarizeMeeting({ utterances, language: "ja" })).rejects.toThrow(/AI|読み取れ|read/);
  });
});

// 長い会議: 分けて要約し、最後に重なりをまとめる
const many = (n: number, text = "話した") =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, track: "mic" as const, startMs: i * 1000, text }));
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("chunkSummaryUtterances", () => {
  it("収まる会議は 1 つのまま。発言数・字数で分け、順序を保つ", () => {
    expect(chunkSummaryUtterances(many(1000))).toHaveLength(1);
    const byCount = chunkSummaryUtterances(many(SUMMARY_CHUNK_MAX_UTTERANCES * 2 + 5));
    expect(byCount.map((c) => c.length)).toEqual([SUMMARY_CHUNK_MAX_UTTERANCES, SUMMARY_CHUNK_MAX_UTTERANCES, 5]);
    const byChars = chunkSummaryUtterances(many(10, "あ".repeat(20_000)));
    expect(byChars.length).toBeGreaterThan(1);
    expect(byChars.flat().map((u) => u.id)).toEqual(many(10).map((u) => u.id));
  });
  it("巨大な 1 発言も単独の塊で残す", () => {
    expect(chunkSummaryUtterances(many(1, "あ".repeat(80_000)))).toHaveLength(1);
  });
});

describe("summarizeMeeting（長い会議）", () => {
  it("分けた回を順に送り、まとめを 1 回呼んで、その結果を返す。進み具合は 回数 + 1", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ decisions: [{ text: "A", sources: ["p0"] }], todos: [], issues: [], model: "m" }))
      .mockResolvedValueOnce(ok({ decisions: [{ text: "A'", sources: ["p1300"] }], todos: [], issues: [], model: "m" }))
      .mockResolvedValueOnce(ok({ decisions: [{ text: "A（まとめ）", sources: ["p0", "p1300"] }], todos: [], issues: [], model: "m" }));
    vi.stubGlobal("fetch", fetchMock);
    const progress: Array<[number, number]> = [];
    const r = await summarizeMeeting({
      utterances: many(1500),
      language: "ja",
      onProgress: (d, t) => progress.push([d, t]),
    });
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls.map((u) => u.replace(/.*\/meeting\//, ""))).toEqual(["summarize", "summarize", "summarize-merge"]);
    const mergeBody = JSON.parse((fetchMock.mock.calls[2][1] as RequestInit).body as string);
    expect(mergeBody.summary.decisions).toEqual([
      { text: "A", sources: ["p0"] },
      { text: "A'", sources: ["p1300"] },
    ]);
    expect(r.decisions).toEqual([{ text: "A（まとめ）", sources: ["p0", "p1300"] }]);
    expect(progress).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]]);
  });

  it("まとめが失敗しても止めず、つなげた結果を返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(ok({ decisions: [{ text: "A", sources: ["p0"] }], todos: [], issues: [], model: "m" }))
        .mockResolvedValueOnce(ok({ decisions: [], todos: [{ text: "T", sources: ["p1300"] }], issues: [], model: "m" }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: "bad" }), { status: 502 })),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await summarizeMeeting({ utterances: many(1500), language: "ja" });
    expect(r.decisions).toEqual([{ text: "A", sources: ["p0"] }]);
    expect(r.todos).toEqual([{ text: "T", sources: ["p1300"] }]);
  });

  it("分けた回のどれかが失敗したら全体を失敗にする", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(ok({ decisions: [{ text: "A", sources: ["p0"] }], todos: [], issues: [], model: "m" }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: "no model" }), { status: 400 })),
    );
    await expect(summarizeMeeting({ utterances: many(1500), language: "ja" })).rejects.toThrow("no model");
  });

  it("伏せるときは、分けた回とまとめの両方が伏せたときだけ masked", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(ok({ decisions: [{ text: "A", sources: ["p0"] }], todos: [], issues: [], model: "m", masked: true }))
        .mockResolvedValueOnce(ok({ decisions: [{ text: "B", sources: ["p1300"] }], todos: [], issues: [], model: "m", masked: false }))
        .mockResolvedValueOnce(ok({ decisions: [{ text: "AB", sources: ["p0", "p1300"] }], todos: [], issues: [], model: "m", masked: true })),
    );
    const r = await summarizeMeeting({ utterances: many(1500), language: "ja", mask: { terms: "" } });
    expect(r.masked).toBe(false);
  });
});
