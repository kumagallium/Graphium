import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphiumDocument } from "../../lib/document-types";
import type { IngesterOutput } from "../../server/services/wiki-ingester";
import { applyFrameTitleResolution, resolveFrameTitles } from "./resolve-frame-titles";

const ing = (triggerTitles: string[], rationaleRuleTitles?: string[]) =>
  ({
    title: "T",
    kind: "claim",
    sections: [],
    decisionFrame: { triggerTitles, action: "a", rationale: null, rationaleRuleTitles },
  }) as unknown as IngesterOutput;

describe("resolveFrameTitles", () => {
  it("兄弟を正規化して解決し、解決できない title は捨てる", () => {
    const r = resolveFrameTitles(ing([" Foo ", "missing"]), [{ title: "foo", id: "w1" }]);
    expect(r.triggerClaimIds).toEqual(["w1"]);
  });
  it("created を優先し、無ければ existing で引く", () => {
    const r = resolveFrameTitles(
      ing(["A", "B"], ["B"]),
      [{ title: "A", id: "new-a" }],
      [{ title: "a", id: "old-a" }, { title: "B", id: "old-b" }],
    );
    expect(r.triggerClaimIds).toEqual(["new-a", "old-b"]);
    expect(r.rationaleRuleIds).toEqual(["old-b"]);
  });
  it("重複を除く／decisionFrame が無ければ空", () => {
    expect(resolveFrameTitles(ing(["A", "a"]), [{ title: "A", id: "x" }]).triggerClaimIds).toEqual(["x"]);
    const none = { title: "T", kind: "claim", sections: [] } as unknown as IngesterOutput;
    expect(resolveFrameTitles(none, [])).toEqual({ triggerClaimIds: [], rationaleRuleIds: [] });
  });
});

describe("resolveFrameTitles - 自己参照", () => {
  it("解決した id が selfId と一致したら除外する", () => {
    const r = resolveFrameTitles(ing(["A", "B"], ["A"]), [{ title: "A", id: "self" }, { title: "B", id: "w2" }], undefined, "self");
    expect(r.triggerClaimIds).toEqual(["w2"]);
    expect(r.rationaleRuleIds).toEqual([]);
  });
});

describe("applyFrameTitleResolution", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const docWith = (frame?: Record<string, unknown>): GraphiumDocument =>
    ({
      version: 2,
      title: "d",
      pages: [],
      wikiMeta: { kind: "claim", ...(frame ? { decisionFrame: frame } : {}) },
    }) as unknown as GraphiumDocument;
  const frame = (p: Record<string, unknown> = {}) => ({
    triggerClaimIds: [],
    action: "a",
    rationale: null,
    rationaleRuleIds: [],
    reviewState: "extracted",
    ...p,
  });
  const makeFm = (docs: Record<string, GraphiumDocument>, save: (id: string, d: GraphiumDocument) => Promise<boolean>) => {
    const handleSaveWikiFile = vi.fn(save);
    return {
      fm: { getCachedDoc: (noteId: string) => docs[noteId], handleSaveWikiFile },
      handleSaveWikiFile,
    };
  };
  const run = async (p: Promise<void>) => {
    await vi.runAllTimersAsync();
    await p;
  };

  it("兄弟・既存の id を解決して保存し、activityType は渡さない", async () => {
    const { fm, handleSaveWikiFile } = makeFm({ "wiki:n1": docWith(frame()) }, async () => true);
    await run(applyFrameTitleResolution(
      fm,
      [{ wiki: ing(["Old", "Sib"], ["Old"]), id: "n1" }, { wiki: { title: "Sib", kind: "claim", sections: [] } as unknown as IngesterOutput, id: "n2" }],
      [{ title: "Old", id: "old1" }],
    ));
    expect(handleSaveWikiFile).toHaveBeenCalledTimes(1);
    const [id, doc] = handleSaveWikiFile.mock.calls[0] as unknown as [string, GraphiumDocument, ...unknown[]];
    expect(handleSaveWikiFile.mock.calls[0]).toHaveLength(2);
    expect(id).toBe("n1");
    expect(doc.wikiMeta?.decisionFrame?.triggerClaimIds).toEqual(["old1", "n2"]);
    expect(doc.wikiMeta?.decisionFrame?.rationaleRuleIds).toEqual(["old1"]);
  });

  it("false が返ったら再試行し、最終的に失敗なら console.warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fm, handleSaveWikiFile } = makeFm({ "wiki:n1": docWith(frame()) }, async () => false);
    await run(applyFrameTitleResolution(fm, [{ wiki: ing(["Sib"]), id: "n1" }, { wiki: { title: "Sib", kind: "claim", sections: [] } as unknown as IngesterOutput, id: "n2" }]));
    expect(handleSaveWikiFile).toHaveBeenCalledTimes(4);
    expect(warn).toHaveBeenCalled();
  });

  it("再試行で成功すれば warn しない", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let n = 0;
    const { fm, handleSaveWikiFile } = makeFm({ "wiki:n1": docWith(frame()) }, async () => ++n >= 2);
    await run(applyFrameTitleResolution(fm, [{ wiki: ing(["Sib"]), id: "n1" }, { wiki: { title: "Sib", kind: "claim", sections: [] } as unknown as IngesterOutput, id: "n2" }]));
    expect(handleSaveWikiFile).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it("例外が出ても後続の知見は処理される", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const docs = { "wiki:n1": docWith(frame()), "wiki:n3": docWith(frame()) };
    const { fm, handleSaveWikiFile } = makeFm(docs, async (id) => {
      if (id === "n1") throw new Error("boom");
      return true;
    });
    const sib = { title: "Sib", kind: "claim", sections: [] } as unknown as IngesterOutput;
    await run(applyFrameTitleResolution(fm, [
      { wiki: ing(["Sib"]), id: "n1" },
      { wiki: sib, id: "n2" },
      { wiki: ing(["Sib"]), id: "n3" },
    ]));
    expect(handleSaveWikiFile.mock.calls.map((c) => c[0])).toEqual(["n1", "n3"]);
  });

  it("confirmed で ids 入りの欄は上書きしない", async () => {
    const f = frame({ reviewState: "confirmed", triggerClaimIds: ["keep"], rationaleRuleIds: [] });
    const { fm, handleSaveWikiFile } = makeFm({ "wiki:n1": docWith(f) }, async () => true);
    await run(applyFrameTitleResolution(
      fm,
      [{ wiki: ing(["Sib"], ["Sib"]), id: "n1" }, { wiki: { title: "Sib", kind: "claim", sections: [] } as unknown as IngesterOutput, id: "n2" }],
    ));
    const saved = handleSaveWikiFile.mock.calls[0][1] as GraphiumDocument;
    expect(saved.wikiMeta?.decisionFrame?.triggerClaimIds).toEqual(["keep"]);
    expect(saved.wikiMeta?.decisionFrame?.rationaleRuleIds).toEqual(["n2"]);
  });

  it("decisionFrame の無い知見は保存されない", async () => {
    const { fm, handleSaveWikiFile } = makeFm({ "wiki:n1": docWith() }, async () => true);
    const none = { title: "T", kind: "claim", sections: [] } as unknown as IngesterOutput;
    await run(applyFrameTitleResolution(fm, [{ wiki: none, id: "n1" }]));
    expect(handleSaveWikiFile).not.toHaveBeenCalled();
  });
});
