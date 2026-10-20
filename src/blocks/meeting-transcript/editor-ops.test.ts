import { describe, expect, it, vi } from "vitest";
import { insertMeetingTranscriptBlock, removeMeetingTranscriptBlock } from "./index";

const props = { recordingId: "r1", fileId: "f1", startedAt: "x" };
const mkEditor = (over: Record<string, unknown> = {}) => {
  const cur = { id: "b0", type: "paragraph", content: [] };
  return {
    isEditable: true,
    getTextCursorPosition: () => ({ block: cur }),
    insertBlocks: vi.fn(),
    removeBlocks: vi.fn(),
    document: [{ type: "paragraph", children: [{ type: "meetingTranscript", props: { recordingId: "r1" }, id: "m" }] }],
    ...over,
  } as any;
};

describe("insertMeetingTranscriptBlock", () => {
  it("読み取り専用なら何もせず false", () => {
    const e = mkEditor({ isEditable: false });
    expect(insertMeetingTranscriptBlock(e, props)).toBe(false);
    expect(e.insertBlocks).not.toHaveBeenCalled();
  });
  it("カーソル行の後ろに挿入し、空行なら置き換える", () => {
    const e = mkEditor();
    expect(insertMeetingTranscriptBlock(e, props)).toBe(true);
    expect(e.insertBlocks).toHaveBeenCalled();
    expect(e.removeBlocks).toHaveBeenCalled();
  });
});

describe("removeMeetingTranscriptBlock", () => {
  it("入れ子の中も recordingId で探して消す。無ければ false", () => {
    const e = mkEditor();
    expect(removeMeetingTranscriptBlock(e, "r1")).toBe(true);
    expect(e.removeBlocks).toHaveBeenCalledWith([expect.objectContaining({ id: "m" })]);
    expect(removeMeetingTranscriptBlock(mkEditor(), "other")).toBe(false);
    expect(removeMeetingTranscriptBlock(mkEditor({ isEditable: false }), "r1")).toBe(false);
  });
});
