// 音量の列から自動停止を決める小さな状態機械（純関数）

/** 話していると見なす RMS */
export const SPEECH_LEVEL = 0.02;
/** 話したあと、これだけ静かなら止める */
export const SILENCE_MS = 1500;
/** 最初からずっと静かなら、これで止める */
export const NO_SPEECH_MS = 8000;

export type AutoStopDecision = "continue" | "stop-after-speech" | "stop-no-speech";

export interface AutoStopSample {
  level: number;
  atMs: number;
}

export interface AutoStopState {
  startMs: number | null;
  speechSeen: boolean;
  lastSpeechMs: number;
}

export const initialAutoStopState: AutoStopState = { startMs: null, speechSeen: false, lastSpeechMs: 0 };

export function stepAutoStop(
  state: AutoStopState,
  sample: AutoStopSample,
): { state: AutoStopState; decision: AutoStopDecision } {
  const startMs = state.startMs ?? sample.atMs;
  let { speechSeen, lastSpeechMs } = state;
  if (sample.level >= SPEECH_LEVEL) {
    speechSeen = true;
    lastSpeechMs = sample.atMs;
  }
  const next: AutoStopState = { startMs, speechSeen, lastSpeechMs };
  if (speechSeen) {
    return { state: next, decision: sample.atMs - lastSpeechMs >= SILENCE_MS ? "stop-after-speech" : "continue" };
  }
  return { state: next, decision: sample.atMs - startMs >= NO_SPEECH_MS ? "stop-no-speech" : "continue" };
}
