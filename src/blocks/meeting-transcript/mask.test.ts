import { describe, expect, it } from "vitest";
import { writeOutState } from "./mask";
import type { CleanupDoc, SummaryDoc } from "../../features/meeting-recorder/artifacts";

const cleanup = (masked?: boolean): CleanupDoc => ({
  version: 1,
  createdAt: "",
  model: "m",
  paragraphs: [{ id: "c1", track: null, startMs: 0, text: "x", sources: [] }],
  ...(masked ? { masked: true } : {}),
});
const summary = (masked?: boolean): SummaryDoc => ({
  version: 1,
  createdAt: "",
  model: "m",
  basedOn: "transcript",
  decisions: [{ text: "x", sources: [] }],
  todos: [],
  issues: [],
  ...(masked ? { masked: true } : {}),
});

describe("writeOutState", () => {
  it("伏せないブロックは、あるものを全部書き出せる", () => {
    expect(writeOutState(false, cleanup(), summary())).toEqual({ summary: null, cleanup: null, transcript: null, file: null });
    // 文字起こしは書き出せるので、ファイルにも保存できる
    expect(writeOutState(false, null, null)).toEqual({ summary: "none", cleanup: "none", transcript: null, file: null });
  });
  it("伏せるブロックは、伏せて作った清書・要約だけ。文字起こしは書き出さない", () => {
    expect(writeOutState(true, cleanup(), summary(true))).toEqual({ summary: null, cleanup: "notMasked", transcript: "masking", file: null });
    expect(writeOutState(true, cleanup(true), null)).toEqual({ summary: "none", cleanup: null, transcript: "masking", file: null });
    // 伏せていて、伏せたものが何も無ければファイルにも保存できない
    expect(writeOutState(true, cleanup(), null)).toEqual({ summary: "none", cleanup: "notMasked", transcript: "masking", file: "none" });
  });
});

describe("remaskCleanup / remaskSummary（書き出す直前にもう一度伏せる）", () => {
  it("あとから足した語を、清書の段落と要約の本文・担当に効かせる", async () => {
    const { remaskCleanup, remaskSummary } = await import("./mask");
    const c = remaskCleanup({ ...cleanup(true), paragraphs: [{ id: "c1", track: null, startMs: 0, text: "北斗の件", sources: [] }] }, ["北斗"], "ja");
    expect(c.paragraphs[0].text).toBe("［伏せ字］の件");
    const s = remaskSummary(
      { ...summary(true), todos: [{ text: "北斗に連絡", owner: "北斗", sources: [] }] },
      ["北斗"],
      "ja",
    );
    expect(s.todos[0]).toMatchObject({ text: "［伏せ字］に連絡", owner: "［伏せ字］" });
    expect(s.masked).toBe(true);
  });
});

describe("rawRanges（清書できなかった部分の範囲）", () => {
  it("続いた raw の段落を 1 つの範囲にまとめる", async () => {
    const { rawRanges } = await import("./artifact-panels");
    const p = (id: string, startMs: number, raw?: boolean) => ({ id, track: null, startMs, text: "x", sources: [{ track: null, startMs }], ...(raw ? { raw: true as const } : {}) });
    expect(rawRanges([p("c1", 0), p("c2", 60_000, true), p("c3", 120_000, true), p("c4", 180_000), p("c5", 240_000, true)])).toEqual([
      "[01:00]〜[02:00]",
      "[04:00]",
    ]);
  });
});
