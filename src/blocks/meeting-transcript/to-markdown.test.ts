import { describe, expect, it } from "vitest";
import { syncLocale } from "../../i18n";
import { meetingTranscriptToMarkdown } from "./to-markdown";
import { rememberTranscript } from "./transcript-cache";

const ctx = { children: [], inlines: [] };
const text = (b: any) => b.content.map((c: any) => c.text).join("");

describe("meetingTranscriptToMarkdown", () => {
  syncLocale("ja");
  it("読めていれば [mm:ss] 話者: text の行を並べる", () => {
    rememberTranscript("fmd1", [
      { track: "system", startMs: 5000, text: "こんにちは" },
      { track: "mic", startMs: 9000, text: "はい" },
    ]);
    const out = meetingTranscriptToMarkdown({ type: "meetingTranscript", props: { fileId: "fmd1", startedAt: "S" } }, ctx);
    expect(out.map(text)).toEqual(["会議の文字起こし（S）", "[00:05] 相手: こんにちは", "[00:09] 自分: はい"]);
  });

  it("読めないときはヘッダー + 案内、展開済みならヘッダー 1 行", () => {
    expect(meetingTranscriptToMarkdown({ type: "meetingTranscript", props: { fileId: "none", startedAt: "S" } }, ctx).map(text))
      .toEqual(["会議の文字起こし（S）", "文字起こしは録音の素材に保存されています（このノートを開くと書き出しに含まれます）"]);
    rememberTranscript("fmd2", [{ track: null, startMs: 0, text: "x" }]);
    expect(meetingTranscriptToMarkdown({ type: "meetingTranscript", props: { fileId: "fmd2", expanded: true } }, ctx)).toHaveLength(1);
  });
});
