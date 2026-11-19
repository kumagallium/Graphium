import { describe, expect, it, vi } from "vitest";
import type { GraphiumDocument, WikiMeta } from "../../lib/document-types";
import {
  linkClaimsToTopicsForSource,
  saveWikiWithRetry,
  selectClaimTopicLinkCandidates,
  type ClaimTopicLinkDeps,
  type ClaimTopicLinkEntry,
} from "./claim-topic-link";

const SOURCE = "source-1";

function makeDoc(title: string, meta: Partial<WikiMeta>): GraphiumDocument {
  return {
    version: 2,
    title,
    pages: [{ id: "main", title, blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
    wikiMeta: { kind: "claim", derivedFromNotes: [SOURCE], ...meta },
  } as unknown as GraphiumDocument;
}

function setup(overrides: Partial<ClaimTopicLinkDeps> = {}, extraDocs: Record<string, GraphiumDocument> = {}) {
  const docs = new Map<string, GraphiumDocument>(Object.entries({
    "wiki:c1": makeDoc("知見 1", {}),
    "wiki:c2": makeDoc("知見 2", {}),
    "wiki:t1": makeDoc("トピック 1", { kind: "topic" }),
    "wiki:t2": makeDoc("トピック 2", { kind: "topic" }),
    ...extraDocs,
  }));
  const listEntries = (): ClaimTopicLinkEntry[] => [...docs].map(([key, doc]) => ({
    id: key.slice("wiki:".length),
    kind: doc.wikiMeta?.kind,
    derivedFromNotes: doc.wikiMeta?.derivedFromNotes,
    topicIds: doc.wikiMeta?.topicIds,
  }));
  const handleSaveWikiFile = vi.fn(async (id: string, doc: GraphiumDocument) => {
    docs.set(`wiki:${id}`, doc);
    return true;
  });
  const judge = vi.fn<ClaimTopicLinkDeps["judge"]>(async () => ({
    links: { c1: ["t1", "t2"], c2: ["t2"] },
    rejected: 0,
  }));
  const deps: ClaimTopicLinkDeps = {
    listEntries,
    loadDoc: async (id) => docs.get(id) ?? null,
    getCachedDoc: (id) => docs.get(id),
    handleSaveWikiFile,
    judge,
    saveRetryDelayMs: 0,
    ...overrides,
  };
  return { docs, deps, judge, handleSaveWikiFile };
}

describe("selectClaimTopicLinkCandidates", () => {
  it("同じ資料の、topicIds が空の知見とトピックだけを選ぶ", () => {
    expect(selectClaimTopicLinkCandidates(SOURCE, [
      { id: "a", kind: "claim", derivedFromNotes: [SOURCE] },
      { id: "b", kind: "claim", derivedFromNotes: [SOURCE], topicIds: [] },
      { id: "c", kind: "claim", derivedFromNotes: [SOURCE], topicIds: ["t"] },
      { id: "d", kind: "claim", derivedFromNotes: ["other"] },
      { id: "t", kind: "topic", derivedFromNotes: [SOURCE] },
      { id: "u", kind: "topic", derivedFromNotes: ["other"] },
      { id: "q", kind: "answer", derivedFromNotes: [SOURCE] },
    ])).toEqual({ claimIds: ["a", "b"], topicIds: ["t"] });
  });
});

describe("linkClaimsToTopicsForSource", () => {
  it("判定は 1 回で、知見の topicIds だけを書く", async () => {
    const { docs, deps, judge, handleSaveWikiFile } = setup();
    const result = await linkClaimsToTopicsForSource(SOURCE, deps);

    expect(judge).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ calls: 1, claimsJudged: 2, linkedClaims: 2, links: 3, rejected: 0, saveFailed: 0 });
    expect(docs.get("wiki:c1")?.wikiMeta?.topicIds).toEqual(["t1", "t2"]);
    expect(docs.get("wiki:c2")?.wikiMeta?.topicIds).toEqual(["t2"]);
    // トピック側は書かない（derivedFromClaims は旧形式の意味を持つ）
    expect(handleSaveWikiFile.mock.calls.map(([id]) => id).sort()).toEqual(["c1", "c2"]);
    expect(docs.get("wiki:t1")?.wikiMeta?.derivedFromClaims).toBeUndefined();
    // 版を刻まない（本文は変わらない）
    expect(handleSaveWikiFile.mock.calls[0]).toHaveLength(2);
  });

  it("知見かトピックが無ければ AI を呼ばない", async () => {
    const noTopics = setup();
    noTopics.docs.delete("wiki:t1");
    noTopics.docs.delete("wiki:t2");
    expect((await linkClaimsToTopicsForSource(SOURCE, noTopics.deps)).calls).toBe(0);
    expect(noTopics.judge).not.toHaveBeenCalled();

    const noClaims = setup();
    noClaims.docs.delete("wiki:c1");
    noClaims.docs.delete("wiki:c2");
    expect((await linkClaimsToTopicsForSource(SOURCE, noClaims.deps)).calls).toBe(0);
    expect(noClaims.judge).not.toHaveBeenCalled();
  });

  it("topicIds がすでにある知見は AI に渡さず、上書きしない", async () => {
    const { docs, deps, judge } = setup({}, { "wiki:c1": makeDoc("知見 1", { topicIds: ["legacy"] }) });
    await linkClaimsToTopicsForSource(SOURCE, deps);
    expect(judge.mock.calls[0][0].map((c) => c.id)).toEqual(["c2"]);
    expect(docs.get("wiki:c1")?.wikiMeta?.topicIds).toEqual(["legacy"]);
  });

  it("判定のあいだに topicIds が付いた知見は上書きしない", async () => {
    const context = setup();
    context.judge.mockImplementation(async () => {
      context.docs.set("wiki:c1", makeDoc("知見 1", { topicIds: ["manual"] }));
      return { links: { c1: ["t1"] }, rejected: 0 };
    });
    const result = await linkClaimsToTopicsForSource(SOURCE, context.deps);
    expect(result).toMatchObject({ alreadyLinked: 1, linkedClaims: 0 });
    expect(context.docs.get("wiki:c1")?.wikiMeta?.topicIds).toEqual(["manual"]);
  });

  it("渡した集合の外・別の資料・上限超えの答えを捨てて数える", async () => {
    const context = setup({}, { "wiki:t3": makeDoc("トピック 3", { kind: "topic" }) });
    context.judge.mockImplementation(async () => {
      // 判定のあいだに t2 が別の資料だけのトピックになった
      context.docs.set("wiki:t2", makeDoc("トピック 2", { kind: "topic", derivedFromNotes: ["other"] }));
      return {
        links: {
          c1: ["t1", "unknown", "t2"],
          c2: ["t1", "t2", "t3", "unknown"],
          outside: ["t1"],
        },
        rejected: 2,
      };
    });
    const result = await linkClaimsToTopicsForSource(SOURCE, context.deps);
    // AI 側 2 + 集合の外 1 + 別の資料 1 + 上限超え 1 + 渡していない知見 1
    expect(result).toMatchObject({ rejected: 6, linkedClaims: 1, links: 1 });
    expect(context.docs.get("wiki:c1")?.wikiMeta?.topicIds).toEqual(["t1"]);
    expect(context.docs.get("wiki:c2")?.wikiMeta?.topicIds).toBeUndefined();
  });

  it("今回作ったトピックは一覧の写しに無くても候補に入る", async () => {
    const context = setup();
    const listed = context.deps.listEntries().filter((e) => e.id !== "t2");
    const result = await linkClaimsToTopicsForSource(SOURCE, {
      ...context.deps,
      listEntries: () => listed,
      extraTopicIds: ["t2"],
    });
    expect(context.judge.mock.calls[0][1].map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(result.linkedClaims).toBe(2);
  });

  it("判定が失敗しても例外を投げず、結果に理由を返す", async () => {
    const failure = new Error("model down");
    const { deps, handleSaveWikiFile } = setup({ judge: vi.fn(async () => { throw failure; }) });
    const result = await linkClaimsToTopicsForSource(SOURCE, deps);
    expect(result).toMatchObject({ calls: 1, linkedClaims: 0, aborted: false, failureError: failure });
    expect(handleSaveWikiFile).not.toHaveBeenCalled();
  });

  it("止められた判定は失敗にせず、何も書かない", async () => {
    const controller = new AbortController();
    const { deps, handleSaveWikiFile } = setup({
      signal: controller.signal,
      judge: vi.fn(async () => {
        controller.abort();
        throw new DOMException("Aborted", "AbortError");
      }),
    });
    const result = await linkClaimsToTopicsForSource(SOURCE, deps);
    expect(result.aborted).toBe(true);
    expect(result.failureError).toBeUndefined();
    expect(handleSaveWikiFile).not.toHaveBeenCalled();
  });

  it("始める前に止められていれば AI を呼ばない", async () => {
    const controller = new AbortController();
    controller.abort();
    const { deps, judge } = setup({ signal: controller.signal });
    expect((await linkClaimsToTopicsForSource(SOURCE, deps)).aborted).toBe(true);
    expect(judge).not.toHaveBeenCalled();
  });

  it("判定のあとに止められたら、残りの知見は書かない", async () => {
    const controller = new AbortController();
    const context = setup({ signal: controller.signal });
    context.handleSaveWikiFile.mockImplementation(async (id, doc) => {
      context.docs.set(`wiki:${id}`, doc);
      controller.abort();
      return true;
    });
    const result = await linkClaimsToTopicsForSource(SOURCE, context.deps);
    expect(result).toMatchObject({ aborted: true, linkedClaims: 1 });
    expect(context.handleSaveWikiFile).toHaveBeenCalledTimes(1);
  });

  it("保存できなかった知見を数え、残りは続ける", async () => {
    const context = setup();
    context.handleSaveWikiFile.mockImplementation(async (id, doc) => {
      if (id === "c1") throw new Error("disk full");
      context.docs.set(`wiki:${id}`, doc);
      return true;
    });
    const result = await linkClaimsToTopicsForSource(SOURCE, context.deps);
    expect(result).toMatchObject({ saveFailed: 1, linkedClaims: 1 });
  });
});

describe("saveWikiWithRetry", () => {
  const doc = makeDoc("知見", {});

  it("他の保存と重なって false が返ったら、やり直して書く", async () => {
    const save = vi.fn<(id: string, d: GraphiumDocument) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    expect(await saveWikiWithRetry(save, "c1", doc, 0)).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("最後まで書けなければ false", async () => {
    const save = vi.fn(async () => false);
    expect(await saveWikiWithRetry(save, "c1", doc, 0)).toBe(false);
    expect(save).toHaveBeenCalledTimes(6);
  });
});
