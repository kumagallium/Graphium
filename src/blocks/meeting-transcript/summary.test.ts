import { describe, expect, it, vi } from "vitest";
import {
  buildSummaryBlocks,
  collectExpandedParagraphs,
  insertSummary,
  paragraphToUtterance,
  type SummaryLabels,
} from "./summary";

const L: SummaryLabels = {
  summaryHeading: "要約",
  aiNote: "AI がまとめました。根拠は各項目のリンクから",
  decisions: "決定事項",
  todos: "TODO",
  issues: "論点",
  transcriptHeading: "文字起こし",
  owner: "担当",
  due: "期限",
};
const text = (b: any) => b.content[0].text;
const para = (id: string, t: string) => ({ id, type: "paragraph", content: [{ type: "text", text: t, styles: {} }] });

describe("buildSummaryBlocks", () => {
  it("見出し → 注記 → 小見出し → 箇条書きの順。空の節は出さない", () => {
    const blocks = buildSummaryBlocks(
      { decisions: [{ text: "A に決定", sources: ["p1"] }], todos: [], issues: [{ text: "B は未定", sources: [] }] },
      L,
    );
    expect(blocks.map((b) => b.type)).toEqual([
      "heading", "paragraph", "heading", "bulletListItem", "heading", "bulletListItem",
    ]);
    expect(blocks[0].props.level).toBe(2);
    expect(text(blocks[0])).toBe("要約");
    expect(text(blocks[1])).toBe(L.aiNote);
    expect(blocks[2].props.level).toBe(3);
    expect(blocks.map((b) => b.type === "heading" && text(b)).filter(Boolean)).toEqual(["要約", "決定事項", "論点"]);
  });

  it("TODO は担当・期限があれば末尾に付ける", () => {
    const blocks = buildSummaryBlocks(
      {
        decisions: [],
        todos: [
          { text: "資料を送る", owner: "田中", due: "金曜", sources: [] },
          { text: "確認する", owner: "鈴木", sources: [] },
          { text: "調べる", sources: [] },
        ],
        issues: [],
      },
      L,
    );
    const items = blocks.filter((b) => b.type === "bulletListItem").map(text);
    expect(items).toEqual(["資料を送る — 担当: 田中 / 期限: 金曜", "確認する — 担当: 鈴木", "調べる"]);
  });
});

describe("collectExpandedParagraphs", () => {
  it("直後から連続する [mm:ss] 段落だけ拾う", () => {
    const doc = [
      { id: "m", type: "meetingTranscript" },
      para("p1", "[00:01] 相手: a"),
      para("p2", "[00:09] b"),
      para("x", "ふつうの段落"),
      para("p3", "[00:20] c"),
    ];
    const editor = { getNextBlock: (b: any) => doc[doc.findIndex((d) => d.id === b.id) + 1] };
    expect(collectExpandedParagraphs(editor, doc[0]).map((b) => b.id)).toEqual(["p1", "p2"]);
  });
});

describe("paragraphToUtterance", () => {
  it("時刻・話者・本文に戻す", () => {
    const lab = { other: "相手", self: "自分" };
    expect(paragraphToUtterance(para("p", "[14:03] 相手: 始めます"), lab)).toEqual({
      id: "p", track: "system", startMs: 843_000, text: "始めます",
    });
    expect(paragraphToUtterance(para("q", "[00:05] 自分: はい"), lab)?.track).toBe("mic");
    expect(paragraphToUtterance(para("r", "[00:05] 話者なし"), lab)?.track).toBeNull();
    expect(paragraphToUtterance(para("s", "ただの文"), lab)).toBeNull();
  });
});

describe("insertSummary", () => {
  const mk = (summaryBlockIds = "") => {
    const blocks: Record<string, any> = {
      m: { id: "m", type: "meetingTranscript", props: { expandedBlockIds: JSON.stringify(["p1", "p2"]), summaryBlockIds } },
      p1: para("p1", "[00:01] a"),
      p2: para("p2", "[00:09] b"),
      old1: para("old1", "古い"),
    };
    let n = 0;
    return {
      getBlock: (id: string) => blocks[id],
      getPrevBlock: vi.fn(() => ({ id: "m", type: "meetingTranscript", content: [] })),
      insertBlocks: vi.fn((bs: any[], _ref?: any, _pos?: string) => bs.map((b) => ({ ...b, id: `n${n++}` }))),
      removeBlocks: vi.fn(),
      updateBlock: vi.fn(),
    };
  };
  const result = {
    decisions: [{ text: "A", sources: ["p1", "zzz"] }],
    todos: [{ text: "T", sources: ["p2"] }],
    issues: [],
    model: "m",
  };

  it("各項目から根拠段落へ derived_from（ai）を張る。入力に無い id は張らない", () => {
    const e = mk();
    const ls = { addLink: vi.fn(), removeLinksForBlock: vi.fn() };
    const ids = insertSummary(e, ls as any, { id: "m", props: {} }, result, L);
    // 先頭: 見出し「文字起こし」を段落群の前に、続いて要約を直後に
    expect(e.insertBlocks.mock.calls[0][2]).toBe("before");
    expect(e.insertBlocks.mock.calls[1][2]).toBe("after");
    expect(ls.addLink).toHaveBeenCalledTimes(2);
    const bullets = e.insertBlocks.mock.results[1].value.filter((b: any) => b.type === "bulletListItem");
    expect(ls.addLink).toHaveBeenCalledWith({
      sourceBlockId: bullets[0].id, targetBlockId: "p1", type: "derived_from", createdBy: "ai", layer: "prov",
    });
    expect(ls.addLink).toHaveBeenCalledWith(expect.objectContaining({ sourceBlockId: bullets[1].id, targetBlockId: "p2" }));
    expect(e.updateBlock).toHaveBeenCalledWith(expect.anything(), {
      props: { summaryBlockIds: JSON.stringify(ids), summaryHash: expect.any(String) },
    });
  });

  it("2 回目は既存の要約を（リンクごと）消してから差し直す", () => {
    const e = mk(JSON.stringify(["old1"]));
    const ls = { addLink: vi.fn(), removeLinksForBlock: vi.fn() };
    insertSummary(e, ls as any, { id: "m", props: {} }, result, L);
    expect(ls.removeLinksForBlock).toHaveBeenCalledWith("old1");
    expect(e.removeBlocks).toHaveBeenCalledWith(["old1"]);
  });

  it("段落の直前に「文字起こし」見出しがあれば足さない", () => {
    const e = mk();
    e.getPrevBlock.mockReturnValue({ id: "h", type: "heading", content: [{ type: "text", text: "文字起こし" }] } as any);
    insertSummary(e, null, { id: "m", props: {} }, result, L);
    expect(e.insertBlocks).toHaveBeenCalledTimes(1);
  });
});

import { hashTexts, isSummaryEdited, pruneNestedIds } from "./summary";

describe("再要約の安全策", () => {
  const base = (summaryBlockIds = "") => {
    const blocks: Record<string, any> = {
      m: { id: "m", props: { expandedBlockIds: JSON.stringify(["p1", "gone"]), summaryBlockIds } },
      p1: para("p1", "[00:01] a"),
      s1: para("s1", "要約"),
      child: para("child", "子"),
    };
    const parents: Record<string, any> = { child: blocks.s1 };
    const calls: string[] = [];
    return {
      calls,
      getBlock: (id: string) => blocks[id],
      getParentBlock: (id: string) => parents[id],
      getPrevBlock: () => ({ type: "heading", content: [{ type: "text", text: "文字起こし" }] }),
      insertBlocks: vi.fn((bs: any[]) => bs.map((b, i) => ({ ...b, id: `n${i}` }))),
      removeBlocks: vi.fn((ids: string[]) => { calls.push(`remove:${ids.join(",")}`); }),
      updateBlock: vi.fn(),
    };
  };
  const full = { decisions: [{ text: "A", sources: ["p1"] }], todos: [], issues: [], model: "m" };

  it("親も削除対象の子は除き、存在しない id は捨てる", () => {
    const e = base(JSON.stringify(["s1", "child", "nope"]));
    expect(pruneNestedIds(e, ["s1", "child"])).toEqual(["s1"]);
    const ls = { addLink: vi.fn(), removeLinksForBlock: vi.fn(() => { e.calls.push("links"); }) };
    insertSummary(e, ls as any, { id: "m", props: { summaryBlockIds: JSON.stringify(["s1", "child", "nope"]) } }, full, L);
    expect(e.removeBlocks).toHaveBeenCalledWith(["s1"]);
  });

  it("ブロック削除 → リンク削除の順。ブロック削除が失敗したらリンクは残す", () => {
    const e = base(JSON.stringify(["s1"]));
    const ls = { addLink: vi.fn(), removeLinksForBlock: vi.fn(() => { e.calls.push("links"); }) };
    insertSummary(e, ls as any, { id: "m", props: {} }, full, L);
    expect(e.calls).toEqual(["remove:s1", "links"]);

    const e2 = base(JSON.stringify(["s1"]));
    e2.removeBlocks.mockImplementation(() => { throw new Error("boom"); });
    const ls2 = { addLink: vi.fn(), removeLinksForBlock: vi.fn() };
    expect(() => insertSummary(e2, ls2 as any, { id: "m", props: { summaryBlockIds: JSON.stringify(["s1"]) } }, full, L)).toThrow("boom");
    expect(ls2.removeLinksForBlock).not.toHaveBeenCalled();
  });

  it("空の結果では何も差し替えない", () => {
    const e = base(JSON.stringify(["s1"]));
    const ls = { addLink: vi.fn(), removeLinksForBlock: vi.fn() };
    const r = insertSummary(e, ls as any, { id: "m", props: { summaryBlockIds: JSON.stringify(["s1"]) } }, { decisions: [], todos: [], issues: [], model: "m" }, L);
    expect(r).toBeNull();
    expect(e.removeBlocks).not.toHaveBeenCalled();
    expect(e.insertBlocks).not.toHaveBeenCalled();
    expect(ls.removeLinksForBlock).not.toHaveBeenCalled();
  });

  it("ハッシュが違えば編集済みと判定する", () => {
    const e = base();
    const hash = hashTexts(["要約"]);
    expect(isSummaryEdited(e, { summaryBlockIds: JSON.stringify(["s1"]), summaryHash: hash })).toBe(false);
    expect(isSummaryEdited(e, { summaryBlockIds: JSON.stringify(["s1"]), summaryHash: hashTexts(["別"]) })).toBe(true);
    expect(isSummaryEdited(e, { summaryBlockIds: JSON.stringify(["s1"]), summaryHash: "" })).toBe(false);
  });
});
