import { describe, expect, it } from "vitest";
import { isMeetingRecording } from "./AudioTranscriptPanel";

describe("isMeetingRecording", () => {
  it("meeting-日付-時刻-トラック.wav に一致", () => {
    expect(isMeetingRecording("audio/wav", "meeting-20261019-1405-system.wav")).toBe(true);
    expect(isMeetingRecording("audio/wav", "meeting-20261019-1405-mic.wav")).toBe(true);
  });
  it("録音時の表示名（ja / en）に一致", () => {
    expect(isMeetingRecording("audio/wav", "会議 2026-10-19 14:05（相手）.wav")).toBe(true);
    expect(isMeetingRecording("audio/wav", "Meeting 2026-10-19 14:05 (Me).wav")).toBe(true);
  });
  it("mimeType が wav でない・形が違う名前は不一致", () => {
    expect(isMeetingRecording("audio/mpeg", "meeting-20261019-1405-mic.wav")).toBe(false);
    expect(isMeetingRecording("audio/wav", "meeting-notes.wav")).toBe(false);
    expect(isMeetingRecording("audio/wav", "会議の音声.wav")).toBe(false);
  });
});
