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
