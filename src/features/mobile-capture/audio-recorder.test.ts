// アプリ内録音の純ロジックのテスト。
//
// 守りたい不変条件:
// - 出力形式は「デスクトップで再生・取り込みしやすい順」に選ばれる（mp4 が先）
// - 録音ファイルの拡張子は MIME 由来で、音声だと拡張子だけで判る
//   （webm / ogg は動画コンテナと衝突するので weba / oga に寄せる）
// - 録音できない環境を取り違えない（フォールバック判定の入口）

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  MAX_RECORDING_MS,
  buildRecordedAudioFile,
  formatRecordingTime,
  isAudioRecordingSupported,
  pickAudioMimeType,
} from "./audio-recorder";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pickAudioMimeType", () => {
  it("prefers audio/mp4 — Safari records only this, and every desktop WebView plays it", () => {
    expect(pickAudioMimeType(() => true)).toBe("audio/mp4");
  });

  it("falls back to Opus in WebM where mp4 recording is unavailable", () => {
    expect(pickAudioMimeType((type) => type.startsWith("audio/webm"))).toBe("audio/webm;codecs=opus");
  });

  it("falls back to Ogg for browsers that offer neither", () => {
    expect(pickAudioMimeType((type) => type.startsWith("audio/ogg"))).toBe("audio/ogg;codecs=opus");
  });

  it("returns undefined when nothing matches so the browser default is used", () => {
    expect(pickAudioMimeType(() => false)).toBeUndefined();
  });
});

describe("buildRecordedAudioFile", () => {
  const when = new Date(2026, 6, 30, 9, 5, 3);
  const blobOf = (type: string) => new Blob([new Uint8Array([1, 2, 3]) as BlobPart], { type });

  it("names the recording by local time and keeps the MIME", () => {
    const file = buildRecordedAudioFile(blobOf("audio/mp4"), when);
    expect(file.name).toBe("voice-20260730-090503.m4a");
    expect(file.type).toBe("audio/mp4");
  });

  it("keeps webm and ogg recordings distinguishable from video by extension", () => {
    expect(buildRecordedAudioFile(blobOf("audio/webm"), when).name).toBe("voice-20260730-090503.weba");
    expect(buildRecordedAudioFile(blobOf("audio/ogg"), when).name).toBe("voice-20260730-090503.oga");
  });

  it("ignores the codecs parameter when choosing the extension", () => {
    expect(buildRecordedAudioFile(blobOf("audio/webm;codecs=opus"), when).name).toBe(
      "voice-20260730-090503.weba",
    );
  });

  it("does not fall through to .bin when the blob has no type", () => {
    const file = buildRecordedAudioFile(new Blob([new Uint8Array([1]) as BlobPart]), when);
    expect(file.name.endsWith(".m4a")).toBe(true);
  });
});

describe("formatRecordingTime", () => {
  it("shows m:ss and never a negative clock", () => {
    expect(formatRecordingTime(0)).toBe("0:00");
    expect(formatRecordingTime(-1)).toBe("0:00");
    expect(formatRecordingTime(9_400)).toBe("0:09");
    expect(formatRecordingTime(65_000)).toBe("1:05");
    expect(formatRecordingTime(MAX_RECORDING_MS)).toBe("10:00");
  });
});

describe("isAudioRecordingSupported", () => {
  it("is false without MediaRecorder (old browsers) — the caller falls back to a file picker", () => {
    expect(isAudioRecordingSupported()).toBe(false);
  });

  it("is false when mediaDevices is missing — http delivery has no secure context", () => {
    vi.stubGlobal("MediaRecorder", function MediaRecorderStub() {} as unknown);
    expect(isAudioRecordingSupported()).toBe(false);
  });

  it("is true once both halves exist", () => {
    vi.stubGlobal("MediaRecorder", function MediaRecorderStub() {} as unknown);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => Promise.resolve({}) } });
    expect(isAudioRecordingSupported()).toBe(true);
  });
});
