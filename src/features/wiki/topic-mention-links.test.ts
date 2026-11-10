import { describe, expect, it } from "vitest";
import type { GraphiumDocument } from "../../lib/document-types";
import { buildTopicMentionLinks, findTopicMentions, relinkTopicMentions } from "./topic-mention-links";

const cands = [
  { id: "a", title: "生地の一次発酵" },
  { id: "b", title: "加水率" },
  { id: "c", title: "天然酵母" },
  { id: "d", title: "BP" },
  { id: "e", title: "DDT" },
  { id: "f", title: "オーブン (家庭用)" },
];

describe("findTopicMentions", () => {
  it("日本語は部分一致で拾う", () => {
    expect(findTopicMentions("生地の一次発酵が進むと", "x", cands)).toEqual(["a"]);
  });
  it("空白違いを吸収する", () => {
    expect(findTopicMentions("生地 の 一次発酵", "x", cands)).toEqual(["a"]);
  });
  it("3 文字未満の題は結ばない", () => {
    expect(findTopicMentions("BP と DDT と BPM", "x", cands)).toEqual(["e"]);
  });
  it("ASCII は語境界で一致し、BPM に当たらない", () => {
    const c = [{ id: "p", title: "BPX" }, { id: "q", title: "DDT" }];
    expect(findTopicMentions("BPXM と ddt-3", "x", c)).toEqual(["q"]);
    expect(findTopicMentions("DDTs", "x", c)).toEqual([]);
  });
  it("自分自身は除く", () => {
    expect(findTopicMentions("加水率の話", "b", cands)).toEqual([]);
    expect(findTopicMentions("加水率の話", "z", cands, { selfTitle: "加水率" })).toEqual([]);
  });
  it("末尾の括弧書きを外して照合する", () => {
    expect(findTopicMentions("オーブンを予熱する", "x", cands)).toEqual(["f"]);
  });
  it("同じ base が 2 件あれば結ばない", () => {
    const c = [{ id: "m", title: "オーブン (家庭用)" }, { id: "n", title: "オーブン (業務用)" }];
    expect(findTopicMentions("オーブンを使う", "x", c)).toEqual([]);
  });
  it("[[source:…]] の中は見ない", () => {
    expect(findTopicMentions("結果 [[source:加水率]] です", "x", cands)).toEqual([]);
  });
});

const block = (id: string, text: string) => ({ id, type: "paragraph", content: [{ type: "text", text }] });
const makeDoc = (body: string, links: any[] = []): GraphiumDocument => ({
  version: 2,
  title: "自家製パン",
  pages: [{
    id: "main", title: "自家製パン",
    blocks: [block("b1", "はじめに"), block("b2", body)],
    labels: {}, provLinks: [], knowledgeLinks: links,
  }],
  source: "ai",
  wikiMeta: { kind: "topic", topicMarkdown: body } as any,
  createdAt: "", modifiedAt: "",
} as any);

describe("buildTopicMentionLinks", () => {
  it("言及が最初に出るブロックを元にし、見つからなければ先頭", () => {
    const blocks = [block("b1", "はじめに"), block("b2", "加水率が高い")];
    const links = buildTopicMentionLinks(blocks, ["b", "c"], cands);
    expect(links[0]).toMatchObject({ sourceBlockId: "b2", targetNoteId: "b", via: "title-mention", layer: "knowledge" });
    expect(links[1].sourceBlockId).toBe("b1");
    expect(buildTopicMentionLinks([], ["b"], cands)).toEqual([]);
  });
});

describe("relinkTopicMentions", () => {
  it("冪等: 2 回目は null", () => {
    const doc = makeDoc("加水率と天然酵母");
    const next = relinkTopicMentions(doc, cands)!;
    expect(next.pages[0].knowledgeLinks.map((l) => l.targetNoteId)).toEqual(["b", "c"]);
    expect(relinkTopicMentions(next, cands)).toBeNull();
  });
  it("候補が消えたら記録が外れ、他の記録は残る", () => {
    const keep = { id: "k", sourceBlockId: "b1", targetBlockId: "", targetNoteId: "zz", type: "reference", layer: "knowledge", createdBy: "ai" };
    const next = relinkTopicMentions(makeDoc("加水率", [keep]), cands)!;
    const gone = relinkTopicMentions(next, cands.filter((c) => c.id !== "b"))!;
    expect(gone.pages[0].knowledgeLinks).toEqual([keep]);
  });
  it("トピック以外・本文なしは null", () => {
    const doc = makeDoc("加水率");
    expect(relinkTopicMentions({ ...doc, wikiMeta: { ...doc.wikiMeta!, kind: "answer" } as any }, cands)).toBeNull();
    expect(relinkTopicMentions({ ...doc, wikiMeta: { kind: "topic" } as any }, cands)).toBeNull();
  });
});
