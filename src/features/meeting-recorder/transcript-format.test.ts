import { describe, expect, it } from "vitest";
import { formatSegmentLine, formatTranscriptJson, parseTranscriptSegments } from "./transcript-format";

const L = { other: "相手", self: "自分" };

describe("formatTranscriptJson", () => {
  it("時刻順に [mm:ss] 話者: text で並べる", () => {
    const json = JSON.stringify({
      segments: [
        { track: "mic", startMs: 75_000, endMs: 76_000, text: "はい", noSpeechProb: 0 },
        { track: "system", startMs: 5_000, endMs: 6_000, text: " こんにちは ", noSpeechProb: null },
      ],
    });
    expect(formatTranscriptJson(json, L)).toBe("[00:05] 相手: こんにちは\n[01:15] 自分: はい");
  });
  it("track が null なら話者を付けない", () => {
    expect(formatTranscriptJson(JSON.stringify({ segments: [{ track: null, startMs: 0, text: "x" }] }), L)).toBe("[00:00] x");
  });
  it("壊れた JSON・空は null", () => {
    expect(formatTranscriptJson("{", L)).toBeNull();
    expect(formatTranscriptJson(null, L)).toBeNull();
    expect(formatTranscriptJson(JSON.stringify({ segments: [] }), L)).toBeNull();
  });
});

describe("parseTranscriptSegments / formatSegmentLine", () => {
  it("時刻順の発言配列にし、空の発言は捨てる", () => {
    const segs = parseTranscriptSegments(
      JSON.stringify({ segments: [{ track: "mic", startMs: 9000, text: "b" }, { track: "system", startMs: 1000, text: "a" }, { startMs: 0, text: " " }] }),
    );
    expect(segs).toEqual([
      { track: "system", startMs: 1000, text: "a" },
      { track: "mic", startMs: 9000, text: "b" },
    ]);
    expect(formatSegmentLine(segs![1], L)).toBe("[00:09] 自分: b");
  });
  it("壊れた JSON は null", () => {
    expect(parseTranscriptSegments("{")).toBeNull();
    expect(parseTranscriptSegments(null)).toBeNull();
  });
});
