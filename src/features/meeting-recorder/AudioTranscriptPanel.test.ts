import { describe, expect, it } from "vitest";
import { isMeetingRecording } from "./AudioTranscriptPanel";

describe("isMeetingRecording", () => {
  it("meeting-日付-時刻.wav に一致", () => {
    expect(isMeetingRecording("audio/wav", "meeting-20261019-1405.wav")).toBe(true);
  });
  it("録音時の表示名（ja / en）に一致", () => {
    expect(isMeetingRecording("audio/wav", "会議 2026-10-19 14:05.wav")).toBe(true);
    expect(isMeetingRecording("audio/wav", "Meeting 2026-10-19 14:05.wav")).toBe(true);
  });
  it("mimeType が wav でない・古い 2 ファイル形式・形が違う名前は不一致", () => {
    expect(isMeetingRecording("audio/mpeg", "meeting-20261019-1405.wav")).toBe(false);
    expect(isMeetingRecording("audio/wav", "meeting-20261019-1405-mic.wav")).toBe(false);
    expect(isMeetingRecording("audio/wav", "meeting-notes.wav")).toBe(false);
    expect(isMeetingRecording("audio/wav", "会議の音声.wav")).toBe(false);
  });
});
