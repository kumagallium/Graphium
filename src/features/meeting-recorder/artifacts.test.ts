import { describe, expect, it } from "vitest";
import { parseCleanupDoc, parseSummaryDoc } from "./artifacts";

describe("parseCleanupDoc", () => {
  it("正しい形を読み、壊れた段落と根拠は捨てる", () => {
    const doc = parseCleanupDoc(
      JSON.stringify({
        version: 1,
        createdAt: "t",
        model: "m",
        paragraphs: [
          { id: "c1", track: "system", startMs: 1000, text: "文", sources: [{ track: "system", startMs: 1000 }, { track: "x", startMs: 1 }] },
          { id: "c2", track: "system", startMs: 2000, text: "   " },
          { id: 3, track: "mic", startMs: 0, text: "id が数字" },
        ],
      }),
    );
    expect(doc?.paragraphs).toEqual([{ id: "c1", track: "system", startMs: 1000, text: "文", sources: [{ track: "system", startMs: 1000 }] }]);
  });
  it("版が違う・壊れた JSON・空は null", () => {
    expect(parseCleanupDoc(JSON.stringify({ version: 2, paragraphs: [] }))).toBeNull();
    expect(parseCleanupDoc("{")).toBeNull();
    expect(parseCleanupDoc(null)).toBeNull();
    expect(parseCleanupDoc(JSON.stringify({ version: 1, paragraphs: [] }))).toBeNull();
  });
});

describe("parseSummaryDoc", () => {
  it("項目を読み、担当・期限は TODO だけ", () => {
    const doc = parseSummaryDoc(
      JSON.stringify({
        version: 1,
        basedOn: "cleanup",
        decisions: [{ text: "決めた", owner: "無視", sources: [] }],
        todos: [{ text: "やる", owner: "A", due: "金曜", sources: [{ track: null, startMs: 5 }] }],
        issues: [],
      }),
    );
    expect(doc?.basedOn).toBe("cleanup");
    expect(doc?.decisions[0]).toEqual({ text: "決めた", sources: [] });
    expect(doc?.todos[0]).toEqual({ text: "やる", owner: "A", due: "金曜", sources: [{ track: null, startMs: 5 }] });
  });
  it("項目が無ければ null、basedOn が不明なら transcript", () => {
    expect(parseSummaryDoc(JSON.stringify({ version: 1, decisions: [], todos: [], issues: [] }))).toBeNull();
    expect(parseSummaryDoc(JSON.stringify({ version: 1, issues: [{ text: "x", sources: [] }] }))?.basedOn).toBe("transcript");
  });
});
