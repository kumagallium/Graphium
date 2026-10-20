import { describe, expect, it } from "vitest";
import { buildTranscriptParagraphs } from "./expand";

const L = { other: "相手", self: "自分" };

describe("buildTranscriptParagraphs", () => {
  it("発言ごとに [mm:ss] 話者: text の段落を 1 つ作る", () => {
    const blocks = buildTranscriptParagraphs(
      [
        { track: "system", startMs: 843_000, text: "始めます" },
        { track: "mic", startMs: 850_500, text: "お願いします" },
      ],
      L,
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "[14:03] 相手: 始めます", styles: {} }],
    });
    expect(blocks[1].content[0].text).toBe("[14:10] 自分: お願いします");
  });

  it("話者不明は話者ラベルなし、発言なしは空配列", () => {
    expect(buildTranscriptParagraphs([{ track: null, startMs: 0, text: "x" }], L)[0].content[0].text).toBe("[00:00] x");
    expect(buildTranscriptParagraphs([], L)).toEqual([]);
  });
});
