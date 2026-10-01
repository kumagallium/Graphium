import { describe, expect, it } from "vitest";
import { buildAiDerivedDocument } from "./note-builder";

const base = {
  title: "要約",
  quotedMarkdown: "引用",
  question: "質問",
  agentResponse: {
    session_id: "",
    message: "回答",
    tool_calls: [],
    provenance_id: null,
    token_usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    model: null,
  },
  sourceNoteId: "src",
  sourceBlockIds: ["b1"],
  parseMarkdown: () => [{ id: "p1", type: "paragraph", content: [{ type: "text", text: "x", styles: {} }], children: [] }],
};

describe("buildAiDerivedDocument の本文の幅", () => {
  it("元が A4 なら A4 を引き継ぐ", () => {
    const doc = buildAiDerivedDocument({ ...base, sourceBodyWidth: { fullWidth: false, paperSize: "a4" } });
    expect(doc.paperSize).toBe("a4");
    expect(doc.fullWidth).toBeUndefined();
  });

  it("元が幅いっぱいなら幅いっぱいを引き継ぐ", () => {
    const doc = buildAiDerivedDocument({ ...base, sourceBodyWidth: { fullWidth: true, paperSize: undefined } });
    expect(doc.fullWidth).toBe(true);
    expect(doc.paperSize).toBeUndefined();
  });

  it("元が標準・指定なしなら項目を書かない", () => {
    const std = buildAiDerivedDocument({ ...base, sourceBodyWidth: { fullWidth: false, paperSize: undefined } });
    expect("paperSize" in std).toBe(false);
    expect("fullWidth" in std).toBe(false);
    const none = buildAiDerivedDocument(base);
    expect("paperSize" in none).toBe(false);
  });
});
