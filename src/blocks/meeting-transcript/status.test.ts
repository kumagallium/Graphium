import { describe, expect, it } from "vitest";
import { approxDurationMs, deriveBlockStatus, mergeSegments, pickVisibleSegments, RECENT_SEGMENT_LIMIT } from "./status";

const base = {
  tauri: true,
  phase: "idle" as const,
  activeRecordingId: null,
  recordingId: "r1",
  fileId: "f1",
  transcribes: {},
  transcript: "loaded" as const,
};
const job = (status: "running" | "done", fileIds: string[]) => ({
  j1: { jobId: "j1", status, ratio: 0, segmentCount: 0, fileIds },
});

describe("deriveBlockStatus", () => {
  it("この録音が進行中なら recording（別の録音なら違う）", () => {
    expect(deriveBlockStatus({ ...base, phase: "recording", activeRecordingId: "r1" })).toBe("recording");
    expect(deriveBlockStatus({ ...base, phase: "recording", activeRecordingId: "r2" })).toBe("done");
  });

  it("この素材の実行中ジョブがあれば transcribing、終わったジョブ・別素材は無関係", () => {
    expect(deriveBlockStatus({ ...base, transcribes: job("running", ["f1"]) })).toBe("transcribing");
    expect(deriveBlockStatus({ ...base, transcribes: job("done", ["f1"]) })).toBe("done");
    expect(deriveBlockStatus({ ...base, transcribes: job("running", ["other"]) })).toBe("done");
  });

  it("読めたら done、読めなければ empty、読み込み中は loading", () => {
    expect(deriveBlockStatus({ ...base, transcript: "missing" })).toBe("empty");
    expect(deriveBlockStatus({ ...base, transcript: null })).toBe("loading");
  });

  it("直近のジョブが失敗・取り消しなら、読めていても failed（実行中・録音中が優先）", () => {
    expect(deriveBlockStatus({ ...base, lastJob: "failed" })).toBe("failed");
    expect(deriveBlockStatus({ ...base, lastJob: "cancelled" })).toBe("failed");
    expect(deriveBlockStatus({ ...base, lastJob: "done" })).toBe("done");
    expect(deriveBlockStatus({ ...base, lastJob: "failed", transcribes: job("running", ["f1"]) })).toBe("transcribing");
  });

  it("デスクトップ以外・fileId なしは unavailable（読みに行かない）", () => {
    expect(deriveBlockStatus({ ...base, tauri: false, transcript: null })).toBe("unavailable");
    expect(deriveBlockStatus({ ...base, fileId: "", transcript: null })).toBe("unavailable");
  });
});

describe("pickVisibleSegments", () => {
  const segs = Array.from({ length: 25 }, (_, i) => ({ track: null, startMs: i * 1000, text: String(i) }));
  it("既定は直近 20 発言、隠した件数を返す", () => {
    const r = pickVisibleSegments(segs, false);
    expect(r.visible).toHaveLength(RECENT_SEGMENT_LIMIT);
    expect(r.visible[0].text).toBe("5");
    expect(r.hidden).toBe(5);
  });
  it("showAll なら全部、少なければそのまま", () => {
    expect(pickVisibleSegments(segs, true)).toEqual({ visible: segs, hidden: 0 });
    expect(pickVisibleSegments(segs.slice(0, 3), false).hidden).toBe(0);
  });
});

describe("mergeSegments / approxDurationMs", () => {
  const a = { track: "system" as const, startMs: 1000, endMs: 2000, text: "a" };
  const b = { track: "mic" as const, startMs: 5000, endMs: 7000, text: "b" };
  it("(話者, 開始, 本文) が同じ発言は 1 つにし、時刻順に並べる", () => {
    expect(mergeSegments([a], [b, { ...a }])).toEqual([a, b]);
    expect(mergeSegments([b], undefined)).toEqual([b]);
    expect(mergeSegments([], [a])).toEqual([a]);
  });
  it("長さの目安は最大 endMs（endMs が無ければ startMs、発言なしは 0）", () => {
    expect(approxDurationMs([a, b])).toBe(7000);
    expect(approxDurationMs([{ track: null, startMs: 3000, text: "x" }])).toBe(3000);
    expect(approxDurationMs([])).toBe(0);
  });
});
