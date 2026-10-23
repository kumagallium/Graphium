import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/platform", () => ({ apiBase: () => "/api", isTauri: () => true }));
vi.mock("../settings/store", () => ({ getMeetingAiLLMModel: () => undefined, getMeetingAiModelName: () => "" }));

import { chunkUtterances, cleanupMeeting, CleanupMessageError } from "./cleanup-service";
import type { SummaryUtterance } from "./summary-service";

const mk = (n: number, text = "あ"): SummaryUtterance[] =>
  Array.from({ length: n }, (_, i) => ({ id: `u${i}`, track: "mic", startMs: i * 1000, text }));

const okRes = (paragraphs: unknown[], model = "m1") =>
  new Response(JSON.stringify({ paragraphs, model }), { status: 200 });

describe("chunkUtterances", () => {
  it("120 発言ごとに分ける", () => {
    const c = chunkUtterances(mk(250));
    expect(c.map((x) => x.length)).toEqual([120, 120, 10]);
  });
  it("字数でも分け、順序を保つ", () => {
    const c = chunkUtterances(mk(10, "あ".repeat(1000)));
    expect(c.length).toBeGreaterThan(1);
    expect(c.flat().map((u) => u.id)).toEqual(mk(10).map((u) => u.id));
    expect(c.every((x) => x.length <= 4)).toBe(true);
  });
  it("巨大な 1 発言も落とさず単独にする・空は空配列", () => {
    expect(chunkUtterances(mk(1, "あ".repeat(9000)))).toHaveLength(1);
    expect(chunkUtterances([])).toEqual([]);
  });
});

describe("cleanupMeeting", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("順に送って連結し、進捗を通知する", async () => {
    const f = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(okRes([{ text: "A", sources: ["u0"] }]))
      .mockResolvedValueOnce(okRes([{ text: "B", sources: ["u120"] }], "m2"));
    const progress: Array<[number, number]> = [];
    const r = await cleanupMeeting({
      utterances: mk(121),
      language: "ja",
      vocabulary: "Graphium",
      onProgress: (d, t) => progress.push([d, t]),
    });
    expect(f).toHaveBeenCalledTimes(2);
    expect(r.paragraphs.map((p) => p.text)).toEqual(["A", "B"]);
    expect(r.model).toBe("m2");
    expect(progress).toEqual([[0, 2], [1, 2], [2, 2]]);
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body.vocabulary).toBe("Graphium");
    expect(body.utterances).toHaveLength(120);
  });

  it("ノートのメモを毎回送り、直した語は回をまたいで同じ組を 1 つにまとめる", async () => {
    const withFixes = (fixes: unknown) =>
      new Response(JSON.stringify({ paragraphs: [{ text: "A", sources: ["u0"] }], fixes, model: "m" }), { status: 200 });
    const f = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(withFixes([{ heard: "聖書", meant: "清書" }]))
      .mockResolvedValueOnce(withFixes([{ heard: "聖書", meant: "清書" }, { heard: "もし起こし", meant: "文字起こし" }, { bad: 1 }]));
    const r = await cleanupMeeting({ utterances: mk(121), language: "ja", notes: "議題: 清書の試験" });
    expect(r.fixes).toEqual([
      { heard: "聖書", meant: "清書" },
      { heard: "もし起こし", meant: "文字起こし" },
    ]);
    for (const call of f.mock.calls) {
      expect(JSON.parse((call[1] as RequestInit).body as string).notes).toBe("議題: 清書の試験");
    }
  });

  it("1 回でも失敗したら全体を失敗にする", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(okRes([{ text: "A", sources: ["u0"] }]))
      .mockResolvedValueOnce(new Response("{}", { status: 502 }));
    await expect(cleanupMeeting({ utterances: mk(121), language: "ja" })).rejects.toBeInstanceOf(
      CleanupMessageError,
    );
  });
});

describe("上限で切れた塊（同じ文を繰り返し続けたときなど）", () => {
  beforeEach(() => vi.restoreAllMocks());
  const cut = () => new Response(JSON.stringify({ error: "cut", code: "AI_OUTPUT_TRUNCATED" }), { status: 502 });
  const ok = (text: string, reasoningTokens: number | null = 0) =>
    new Response(JSON.stringify({ paragraphs: [{ text, sources: ["u0"] }], model: "m", reasoningTokens }), { status: 200 });
  const bodyOf = (f: ReturnType<typeof vi.spyOn>, i: number) => JSON.parse((f.mock.calls[i][1] as RequestInit).body as string);

  it("温度を上げて 1 回だけやり直し、通ればそのまま使う", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(cut()).mockResolvedValueOnce(ok("A"));
    const r = await cleanupMeeting({ utterances: mk(3), language: "ja" });
    expect(f).toHaveBeenCalledTimes(2);
    expect(bodyOf(f, 0).retry).toBeUndefined();
    expect(bodyOf(f, 1).retry).toBe(true);
    expect(r.paragraphs.map((p) => p.text)).toEqual(["A"]);
  });

  it("やり直しても切れたら、その塊だけ元の発言のまま（raw）。ほかの塊は清書のまま", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(cut()).mockResolvedValueOnce(cut()).mockResolvedValueOnce(ok("B"));
    const r = await cleanupMeeting({ utterances: [...mk(120, "えー元の発言"), ...mk(1)], language: "ja" });
    expect(r.paragraphs.slice(0, 2)).toEqual([
      { text: "えー元の発言", sources: ["u0"], raw: true },
      { text: "えー元の発言", sources: ["u1"], raw: true },
    ]);
    expect(r.paragraphs[r.paragraphs.length - 1]?.text).toBe("B");
  });

  it("伏せるときは、切れた塊の生の文を入れず「省いた」1 行にする", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(cut()).mockResolvedValueOnce(cut());
    const r = await cleanupMeeting({ utterances: mk(3, "田中さん"), language: "ja", mask: { terms: "" } });
    expect(r.paragraphs).toHaveLength(1);
    expect(r.paragraphs[0].raw).toBe(true);
    expect(r.paragraphs[0].text).not.toContain("田中");
    expect(r.paragraphs[0].sources).toEqual(["u0", "u1", "u2"]);
  });

  it("考える部分を使わないモデルだと分かったら、次の回から出力上限を詰める（tight）", async () => {
    const f = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(ok("A", 0))
      .mockResolvedValueOnce(ok("B", 900))
      .mockResolvedValueOnce(ok("C", 0));
    await cleanupMeeting({ utterances: mk(241), language: "ja" });
    expect([0, 1, 2].map((i) => bodyOf(f, i).outputBudget)).toEqual(["roomy", "tight", "roomy"]);
  });

  it("切れた以外の失敗はこれまでどおり全体を失敗にする", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ error: "x" }), { status: 502 }));
    await expect(cleanupMeeting({ utterances: mk(3), language: "ja" })).rejects.toBeInstanceOf(CleanupMessageError);
  });
});
