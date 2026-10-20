// 文字起こしブロックの usedIn 走査（media-index v10）
import { describe, expect, it } from "vitest";
import { collectMeetingTranscriptFileIdsFromBlocks } from "./media-index";

describe("collectMeetingTranscriptFileIdsFromBlocks", () => {
  it("子ブロック・カラム内の文字起こしブロックの fileId を集め、空や別型は無視する", () => {
    const blocks = [
      { type: "meetingTranscript", props: { fileId: "f-top" } },
      { type: "meetingTranscript", props: { fileId: "" } },
      { type: "paragraph", props: { fileId: "x" } },
      {
        type: "columnList",
        children: [{ type: "column", children: [{ type: "meetingTranscript", props: { fileId: "f-col" } }] }],
      },
    ];
    expect([...collectMeetingTranscriptFileIdsFromBlocks(blocks as any)].sort()).toEqual(["f-col", "f-top"]);
  });
});
