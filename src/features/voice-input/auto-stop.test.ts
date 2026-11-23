import { describe, it, expect } from "vitest";
import { initialAutoStopState, NO_SPEECH_MS, SILENCE_MS, SPEECH_LEVEL, stepAutoStop, type AutoStopDecision } from "./auto-stop";

function run(samples: { level: number; atMs: number }[]): AutoStopDecision[] {
  let state = initialAutoStopState;
  return samples.map((s) => {
    const r = stepAutoStop(state, s);
    state = r.state;
    return r.decision;
  });
}

describe("stepAutoStop", () => {
  it("話している間は continue", () => {
    expect(run([{ level: 0.1, atMs: 0 }, { level: 0.1, atMs: 100 }])).toEqual(["continue", "continue"]);
  });
  it("話したあと SILENCE_MS 静かなら stop-after-speech", () => {
    const d = run([
      { level: SPEECH_LEVEL, atMs: 0 },
      { level: 0, atMs: SILENCE_MS - 1 },
      { level: 0, atMs: SILENCE_MS },
    ]);
    expect(d).toEqual(["continue", "continue", "stop-after-speech"]);
  });
  it("途中で話し直せば静けさの計測は戻る", () => {
    const d = run([
      { level: 0.1, atMs: 0 },
      { level: 0, atMs: 1400 },
      { level: 0.1, atMs: 1500 },
      { level: 0, atMs: 2900 },
    ]);
    expect(d.every((x) => x === "continue")).toBe(true);
  });
  it("最初からずっと静かなら NO_SPEECH_MS で stop-no-speech", () => {
    const d = run([
      { level: 0, atMs: 100 },
      { level: 0, atMs: 100 + NO_SPEECH_MS - 1 },
      { level: 0, atMs: 100 + NO_SPEECH_MS },
    ]);
    expect(d).toEqual(["continue", "continue", "stop-no-speech"]);
  });
  it("話し始める前の静けさでは stop-after-speech にならない", () => {
    expect(run([{ level: 0, atMs: 0 }, { level: 0, atMs: SILENCE_MS + 10 }])).toEqual(["continue", "continue"]);
  });
});
