// 話題の段（runTopicStage）の Tier 1〜2 テスト。
// composeTopicBody / nameTopicsForClaims は fetch 経由でサーバーを叩くので、
// このテストでは global.fetch をモックし、依存（fm 相当）もすべてスタブする。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runTopicStage, type TopicStageDeps, type TopicStageClaimInput } from "./topic-stage";
import type { GraphiumDocument, WikiMeta } from "../../lib/document-types";

function makeClaimDoc(id: string, title: string, topicIds: string[] = []): GraphiumDocument {
  const wikiMeta: WikiMeta = {
    kind: "claim",
    derivedFromNotes: [],
    derivedFromChats: [],
    topicIds,
    generatedAt: new Date().toISOString(),
    generatedBy: { model: "test-model", version: "1.0.0" },
  };
  return {
    version: 2,
    title,
    pages: [{ id: "main", title, blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
    source: "ai",
    wikiMeta,
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  };
}

function makeTopicDoc(id: string, title: string, memberClaimIds: string[]): GraphiumDocument {
  const wikiMeta: WikiMeta = {
    kind: "topic",
    derivedFromNotes: [],
    derivedFromChats: [],
    derivedFromClaims: memberClaimIds,
    generatedAt: new Date().toISOString(),
    generatedBy: { model: "test-model", version: "1.0.0" },
  };
  return {
    version: 2,
    title,
    pages: [{ id: "main", title, blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
    source: "ai",
    wikiMeta,
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  };
}

/** テスト用の最小限の deps。docs は id → doc の Map で表現し、save/create はその Map を書き換える。 */
function makeDeps(overrides: Partial<TopicStageDeps> = {}): { deps: TopicStageDeps; docs: Map<string, GraphiumDocument> } {
  const docs = new Map<string, GraphiumDocument>();
  let nextId = 0;
  const deps: TopicStageDeps = {
    loadDoc: vi.fn(async (id: string) => docs.get(id) ?? null),
    getCachedDoc: vi.fn((id: string) => docs.get(id) ?? null),
    handleSaveWikiFile: vi.fn(async (wikiId: string, doc: GraphiumDocument) => {
      docs.set(`wiki:${wikiId}`, doc);
      return true;
    }),
    handleCreateWikiFile: vi.fn(async (doc: GraphiumDocument) => {
      const id = `new-topic-${nextId++}`;
      docs.set(`wiki:${id}`, doc);
      return id;
    }),
    existingTopicRefs: [],
    locale: "ja",
    log: vi.fn(),
    ...overrides,
  };
  return { deps, docs };
}

describe("runTopicStage", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("claims が 0 件なら何もしない", async () => {
    const { deps } = makeDeps();
    const result = await runTopicStage([], deps);
    expect(result).toMatchObject({ created: 0, updated: 0, failed: 0, withoutTopic: 0 });
    expect(deps.loadDoc).not.toHaveBeenCalled();
  });

  it("既存話題にタイトル一致した claim は追記され updated が増える", async () => {
    const { deps, docs } = makeDeps({
      existingTopicRefs: [{ id: "topic-1", title: "既存話題" }],
    });
    docs.set("wiki:claim-1", makeClaimDoc("claim-1", "知見1"));
    docs.set("wiki:topic-1", makeTopicDoc("topic-1", "既存話題", []));

    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/compose-topic")) {
        return { ok: true, json: async () => ({ body: "## 定義\n本文" }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const claims: TopicStageClaimInput[] = [
      { id: "claim-1", title: "知見1", body: "本文プレビュー", topics: ["既存話題"] },
    ];
    const result = await runTopicStage(claims, deps);

    expect(result).toMatchObject({ created: 0, updated: 1, failed: 0, withoutTopic: 0 });
    expect(deps.handleSaveWikiFile).toHaveBeenCalledWith(
      "topic-1",
      expect.objectContaining({ wikiMeta: expect.objectContaining({ derivedFromClaims: ["claim-1"] }) }),
      expect.objectContaining({ activityType: "wiki_cross_update" }),
    );
    // claim 側の topicIds も更新される
    const savedClaim = docs.get("wiki:claim-1");
    expect(savedClaim?.wikiMeta?.topicIds).toEqual(["topic-1"]);
  });

  it("既存話題に一致しない topics は新規話題ページを作り created が増える", async () => {
    const { deps, docs } = makeDeps();
    docs.set("wiki:claim-1", makeClaimDoc("claim-1", "知見1"));

    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/compose-topic")) {
        return { ok: true, json: async () => ({ body: "## 定義\n本文" }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const claims: TopicStageClaimInput[] = [
      { id: "claim-1", title: "知見1", body: "本文プレビュー", topics: ["新しい話題"] },
    ];
    const result = await runTopicStage(claims, deps);

    expect(result).toMatchObject({ created: 1, updated: 0, failed: 0, withoutTopic: 0 });
    // 並行実行の引き継ぎ用に、作った話題の id とタイトルが返る
    expect(result.createdTopics).toEqual([expect.objectContaining({ title: expect.any(String) })]);
    expect(deps.handleCreateWikiFile).toHaveBeenCalledTimes(1);
  });

  it("compose-topic が失敗した match は failed に数え、他の claim には影響しない", async () => {
    const { deps, docs } = makeDeps();
    docs.set("wiki:claim-1", makeClaimDoc("claim-1", "知見1"));
    docs.set("wiki:claim-2", makeClaimDoc("claim-2", "知見2"));

    let call = 0;
    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/compose-topic")) {
        call++;
        if (call === 1) return { ok: false, status: 500, text: async () => "{}" };
        return { ok: true, json: async () => ({ body: "## 定義\n本文" }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const claims: TopicStageClaimInput[] = [
      { id: "claim-1", title: "知見1", body: "本文1", topics: ["話題A"] },
      { id: "claim-2", title: "知見2", body: "本文2", topics: ["話題B"] },
    ];
    const result = await runTopicStage(claims, deps);

    expect(result.failed).toBe(1);
    expect(result.created).toBe(1);
    // compose 失敗した claim-1 は「その話題への割り当て失敗」と「話題なし」の両方に数わる
    // （非対称なリンクを避けるため、失敗した match は claim 側もリンクしない）。
    expect(result.withoutTopic).toBe(1);
  });

  it("topics が空の claim は name-topics で補完し、成功すれば通常どおり割り当てる", async () => {
    const { deps, docs } = makeDeps({
      existingTopicRefs: [{ id: "topic-1", title: "既存話題" }],
    });
    docs.set("wiki:claim-1", makeClaimDoc("claim-1", "知見1"));
    docs.set("wiki:topic-1", makeTopicDoc("topic-1", "既存話題", []));

    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/name-topics")) {
        return { ok: true, json: async () => ({ topics: { "claim-1": ["既存話題"] } }) };
      }
      if (String(url).includes("/compose-topic")) {
        return { ok: true, json: async () => ({ body: "## 定義\n本文" }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const claims: TopicStageClaimInput[] = [
      { id: "claim-1", title: "知見1", body: "本文プレビュー", topics: [] },
    ];
    const result = await runTopicStage(claims, deps);

    expect(result).toMatchObject({ created: 0, updated: 1, failed: 0, withoutTopic: 0 });
  });

  it("name-topics 呼び出し自体が失敗したら failed に数え、withoutTopic にはしない", async () => {
    const { deps, docs } = makeDeps();
    docs.set("wiki:claim-1", makeClaimDoc("claim-1", "知見1"));

    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/name-topics")) {
        return { ok: false, status: 500, text: async () => "{}" };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const claims: TopicStageClaimInput[] = [
      { id: "claim-1", title: "知見1", body: "本文プレビュー", topics: [] },
    ];
    const result = await runTopicStage(claims, deps);

    expect(result).toMatchObject({ created: 0, updated: 0, failed: 1, withoutTopic: 0 });
    expect(deps.log).toHaveBeenCalled();
  });

  it("name-topics が補完しても空のままなら withoutTopic に数える", async () => {
    const { deps, docs } = makeDeps();
    docs.set("wiki:claim-1", makeClaimDoc("claim-1", "知見1"));

    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/name-topics")) {
        return { ok: true, json: async () => ({ topics: {} }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const claims: TopicStageClaimInput[] = [
      { id: "claim-1", title: "知見1", body: "本文プレビュー", topics: [] },
    ];
    const result = await runTopicStage(claims, deps);

    expect(result).toMatchObject({ created: 0, updated: 0, failed: 0, withoutTopic: 1 });
  });

  it("claim ドキュメントが見つからない場合は withoutTopic に数えログを出す", async () => {
    const { deps } = makeDeps();
    const claims: TopicStageClaimInput[] = [
      { id: "missing-claim", title: "知見1", body: "本文プレビュー", topics: ["話題A"] },
    ];
    const result = await runTopicStage(claims, deps);
    expect(result).toMatchObject({ created: 0, updated: 0, failed: 0, withoutTopic: 1 });
    expect(deps.log).toHaveBeenCalled();
  });
});
