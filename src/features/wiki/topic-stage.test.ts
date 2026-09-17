// 話題の段（runTopicStage）の Tier 1〜2 テスト。
// composeTopicBody / nameTopicsForClaims は fetch 経由でサーバーを叩くので、
// このテストでは global.fetch をモックし、依存（fm 相当）もすべてスタブする。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  runTopicStage, type TopicStageDeps, type TopicStageClaimInput,
  planExistingTopicMerges, consolidateExistingTopics, mergeTopicsExplicit,
  type ExistingTopicForMerge, type ConsolidateExistingTopicsDeps,
  runSourceTopicStage, type SourceTopicStageDeps, type SourceTopicStageInput,
  rebuildTopicFromSources, type RebuildTopicFromSourcesDeps,
  isIngestInsufficient,
} from "./topic-stage";
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

  it("name-topics には既存話題を「タイトル + 定義の先頭文」の index として渡す", async () => {
    const { deps, docs } = makeDeps({
      existingTopicRefs: [{ id: "topic-1", title: "既存話題", oneLiner: "既存話題の定義。" }],
    });
    docs.set("wiki:claim-1", makeClaimDoc("claim-1", "知見1"));

    let sentBody: any;
    (global.fetch as any).mockImplementation(async (url: string, init: any) => {
      if (String(url).includes("/name-topics")) {
        sentBody = JSON.parse(init.body);
        return { ok: true, json: async () => ({ topics: {} }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const claims: TopicStageClaimInput[] = [
      { id: "claim-1", title: "知見1", body: "本文プレビュー", topics: [] },
    ];
    await runTopicStage(claims, deps);

    expect(sentBody.existingTopics).toEqual(["既存話題: 既存話題の定義。"]);
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

/** 新形式トピック（topicMarkdown あり）のテスト用ドキュメント */
function makeSourceTopicDoc(title: string, topicMarkdown: string, sourceIds: string[]): GraphiumDocument {
  const wikiMeta: WikiMeta = {
    kind: "topic",
    derivedFromNotes: sourceIds,
    derivedFromChats: [],
    derivedFromClaims: [],
    topicMarkdown,
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

function makeSourceDeps(
  overrides: Partial<SourceTopicStageDeps> = {},
): { deps: SourceTopicStageDeps; docs: Map<string, GraphiumDocument> } {
  const docs = new Map<string, GraphiumDocument>();
  let nextId = 0;
  const deps: SourceTopicStageDeps = {
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
    resolveSource: vi.fn(async () => undefined),
    log: vi.fn(),
    ...overrides,
  };
  return { deps, docs };
}

describe("runSourceTopicStage", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("sources が 0 件なら何もしない", async () => {
    const { deps } = makeSourceDeps();
    const result = await runSourceTopicStage([], deps);
    expect(result).toMatchObject({ created: 0, updated: 0, migrated: 0, failed: 0 });
    expect(deps.loadDoc).not.toHaveBeenCalled();
  });

  it("route-topics が create を返せば新形式トピックを新規作成する", async () => {
    const { deps } = makeSourceDeps();
    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/route-topics")) {
        return { ok: true, json: async () => ({ update: [], create: ["新トピック"] }) };
      }
      if (String(url).includes("/revise-topic")) {
        return { ok: true, json: async () => ({ body: "## 定義\n本文[[source:note-1]]" }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const sources: SourceTopicStageInput[] = [{ id: "note-1", title: "資料タイトル", text: "資料本文" }];
    const result = await runSourceTopicStage(sources, deps);

    expect(result).toMatchObject({ created: 1, updated: 0, migrated: 0, failed: 0 });
    expect(deps.handleCreateWikiFile).toHaveBeenCalledTimes(1);
    const [createdDoc] = (deps.handleCreateWikiFile as any).mock.calls[0];
    expect(createdDoc.wikiMeta.topicMarkdown).toContain("本文");
    expect(createdDoc.wikiMeta.derivedFromNotes).toEqual(["note-1"]);
    expect(result.touchedTopicIds).toEqual(result.createdTopics.map((t) => t.id));
  });

  it("route-topics が既存の新形式トピックを update に返せば前の本文込みで改訂する", async () => {
    const { deps, docs } = makeSourceDeps({
      existingTopicRefs: [{ id: "topic-1", title: "既存トピック" }],
      resolveSource: vi.fn(async (id: string) => (id === "note-0" ? { title: "旧資料", text: "旧資料の本文" } : undefined)),
    });
    docs.set("wiki:topic-1", makeSourceTopicDoc("既存トピック", "## 定義\n旧本文[[source:note-0]]", ["note-0"]));

    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/route-topics")) {
        return { ok: true, json: async () => ({ update: ["topic-1"], create: [] }) };
      }
      if (String(url).includes("/revise-topic")) {
        return { ok: true, json: async () => ({ body: "## 定義\n新本文[[source:note-1]]" }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const sources: SourceTopicStageInput[] = [{ id: "note-1", title: "資料1", text: "本文1" }];
    const result = await runSourceTopicStage(sources, deps);

    expect(result).toMatchObject({ created: 0, updated: 1, migrated: 0, failed: 0 });
    const saved = docs.get("wiki:topic-1");
    expect(saved?.wikiMeta?.topicMarkdown).toContain("新本文");
    expect(saved?.wikiMeta?.derivedFromNotes?.sort()).toEqual(["note-0", "note-1"]);
    expect(result.touchedTopicIds).toEqual(["topic-1"]);
  });

  it("resolveSourceTitle があれば、過去の資料に対して resolveSource（全文取得）を呼ばない", async () => {
    const resolveSource = vi.fn(async () => ({ title: "呼ばれてはいけない", text: "全文" }));
    const { deps, docs } = makeSourceDeps({
      existingTopicRefs: [{ id: "topic-1", title: "既存トピック" }],
      resolveSource,
      resolveSourceTitle: vi.fn((id: string) => (id === "note-0" ? "軽量タイトル" : undefined)),
    });
    docs.set("wiki:topic-1", makeSourceTopicDoc("既存トピック", "## 定義\n旧本文[[source:note-0]]", ["note-0"]));

    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/route-topics")) {
        return { ok: true, json: async () => ({ update: ["topic-1"], create: [] }) };
      }
      if (String(url).includes("/revise-topic")) {
        return { ok: true, json: async () => ({ body: "## 定義\n新本文[[source:note-1]]" }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const sources: SourceTopicStageInput[] = [{ id: "note-1", title: "資料1", text: "本文1" }];
    const result = await runSourceTopicStage(sources, deps);

    expect(result).toMatchObject({ updated: 1, failed: 0 });
    expect(resolveSource).not.toHaveBeenCalledWith("note-0");
    const saved = docs.get("wiki:topic-1");
    expect(saved?.wikiMeta?.derivedFromNotes?.sort()).toEqual(["note-0", "note-1"]);
  });

  it("旧形式（知見由来）トピックが update に選ばれたら新形式へ移行する", async () => {
    const { deps, docs } = makeSourceDeps({
      existingTopicRefs: [{ id: "topic-1", title: "旧トピック" }],
      resolveSource: vi.fn(async (id: string) => {
        if (id === "old-note-1") return { title: "旧資料", text: "旧資料の本文" };
        return undefined;
      }),
    });
    docs.set("wiki:topic-1", makeTopicDoc("topic-1", "旧トピック", ["claim-1"]));
    const claimDoc = makeClaimDoc("claim-1", "知見1");
    claimDoc.wikiMeta!.derivedFromNotes = ["old-note-1"];
    docs.set("wiki:claim-1", claimDoc);

    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/route-topics")) {
        return { ok: true, json: async () => ({ update: ["topic-1"], create: [] }) };
      }
      if (String(url).includes("/revise-topic")) {
        return { ok: true, json: async () => ({ body: "## 定義\n組み直した本文" }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const sources: SourceTopicStageInput[] = [{ id: "new-note-1", title: "新資料", text: "新資料の本文" }];
    const result = await runSourceTopicStage(sources, deps);

    expect(result).toMatchObject({ created: 0, updated: 1, migrated: 1, failed: 0 });
    const saved = docs.get("wiki:topic-1");
    expect(saved?.wikiMeta?.topicMarkdown).toBeDefined();
    expect(saved?.wikiMeta?.derivedFromNotes).toEqual(["old-note-1", "new-note-1"]);
  });

  it("route-topics の呼び出し自体が失敗すれば failed に数える", async () => {
    const { deps } = makeSourceDeps();
    (global.fetch as any).mockImplementation(async () => ({ ok: false, status: 500, text: async () => "{}" }));

    const sources: SourceTopicStageInput[] = [{ id: "note-1", title: "資料", text: "本文" }];
    const result = await runSourceTopicStage(sources, deps);
    expect(result).toMatchObject({ created: 0, updated: 0, failed: 1 });
    expect(deps.log).toHaveBeenCalled();
  });
});

describe("rebuildTopicFromSources", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("資料本文が取得できない id は飛ばして件数を返す", async () => {
    const { docs } = makeSourceDeps();
    docs.set("wiki:topic-1", makeSourceTopicDoc("トピック", "", []));
    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/revise-topic")) {
        return { ok: true, json: async () => ({ body: "## 定義\n本文" }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const resolveSource = vi.fn(async (id: string) => (id === "ok-note" ? { title: "資料", text: "本文" } : undefined));
    const deps: RebuildTopicFromSourcesDeps = {
      loadDoc: vi.fn(async (id: string) => docs.get(id) ?? null),
      getCachedDoc: vi.fn((id: string) => docs.get(id) ?? null),
      handleSaveWikiFile: vi.fn(async (wikiId: string, doc: GraphiumDocument) => {
        docs.set(`wiki:${wikiId}`, doc);
        return true;
      }),
      resolveSource,
      locale: "ja",
      log: vi.fn(),
    };

    const result = await rebuildTopicFromSources("topic-1", ["missing-note", "ok-note"], deps);
    expect(result).toMatchObject({ rebuilt: true, sourcesUsed: 1, sourcesSkipped: 1 });
    expect(docs.get("wiki:topic-1")?.wikiMeta?.derivedFromNotes).toEqual(["ok-note"]);
  });

  it("どの資料も解決できなければ rebuilt: false", async () => {
    const { docs } = makeSourceDeps();
    docs.set("wiki:topic-1", makeSourceTopicDoc("トピック", "", []));
    const deps: RebuildTopicFromSourcesDeps = {
      loadDoc: vi.fn(async (id: string) => docs.get(id) ?? null),
      getCachedDoc: vi.fn((id: string) => docs.get(id) ?? null),
      handleSaveWikiFile: vi.fn(async () => true),
      resolveSource: vi.fn(async () => undefined),
      locale: "ja",
    };
    const result = await rebuildTopicFromSources("topic-1", ["a", "b"], deps);
    expect(result).toEqual({ rebuilt: false, sourcesUsed: 0, sourcesSkipped: 2 });
  });

  it("対象がトピックでなければ全件 skipped", async () => {
    const { docs } = makeSourceDeps();
    docs.set("wiki:claim-1", makeClaimDoc("claim-1", "知見"));
    const deps: RebuildTopicFromSourcesDeps = {
      loadDoc: vi.fn(async (id: string) => docs.get(id) ?? null),
      getCachedDoc: vi.fn((id: string) => docs.get(id) ?? null),
      handleSaveWikiFile: vi.fn(async () => true),
      resolveSource: vi.fn(async () => ({ title: "t", text: "x" })),
      locale: "ja",
    };
    const result = await rebuildTopicFromSources("claim-1", ["a"], deps);
    expect(result).toEqual({ rebuilt: false, sourcesUsed: 0, sourcesSkipped: 1 });
  });
});

describe("planExistingTopicMerges", () => {
  // 空白差は normalizeTopicTitle 自体が同一視するため、ここでは助詞の有無のように
  // 正規化だけでは同一と判定されない表記ゆれを例にする（consolidate-topics が本領を発揮する対象）。
  const topics: ExistingTopicForMerge[] = [
    { id: "t1", title: "還元反応速度", memberClaimIds: ["c1"] },
    { id: "t2", title: "還元の反応速度", memberClaimIds: ["c2"] },
    { id: "t3", title: "Ti 置換の影響", memberClaimIds: ["c3"] },
  ];

  it("正式名に自己一致する話題を target に選ぶ", () => {
    const mapping = { "還元反応速度": "還元反応速度", "還元の反応速度": "還元反応速度" };
    const plan = planExistingTopicMerges(topics, mapping);
    expect(plan.get("t2")).toBe("t1");
    expect(plan.has("t1")).toBe(false);
    expect(plan.has("t3")).toBe(false);
  });

  it("mapping に無い話題（自身にしか一致しない）は統合対象にしない", () => {
    const mapping = { "還元反応速度": "還元反応速度" };
    const plan = planExistingTopicMerges(topics, mapping);
    expect(plan.size).toBe(0);
  });

  it("自己一致する話題が無ければ先頭を target に選ぶ", () => {
    const mapping = { "還元反応速度": "統合名", "還元の反応速度": "統合名" };
    const plan = planExistingTopicMerges(topics, mapping);
    expect(plan.get("t2")).toBe("t1");
  });
});

describe("consolidateExistingTopics", () => {
  const originalFetch = global.fetch;
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

  function makeMergeDeps(
    docs: Map<string, GraphiumDocument>,
    overrides: Partial<ConsolidateExistingTopicsDeps> = {},
  ): ConsolidateExistingTopicsDeps {
    return {
      loadDoc: vi.fn(async (id: string) => docs.get(id) ?? null),
      getCachedDoc: vi.fn((id: string) => docs.get(id) ?? null),
      handleSaveWikiFile: vi.fn(async (wikiId: string, doc: GraphiumDocument) => {
        docs.set(`wiki:${wikiId}`, doc);
        return true;
      }),
      handleDeleteWikiFile: vi.fn(async () => {}),
      resolveSource: vi.fn(async () => undefined),
      locale: "ja",
      log: vi.fn(),
      ...overrides,
    };
  }

  it("既存話題が 2 件未満なら何もしない", async () => {
    const docs = new Map<string, GraphiumDocument>();
    const deps = makeMergeDeps(docs);
    const result = await consolidateExistingTopics([{ id: "t1", title: "話題", memberClaimIds: [] }], deps);
    expect(result).toEqual({ merged: 0, rebuilt: 0, failed: 0 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("旧形式どうしの統合: 対応表に沿って吸収元の資料の和から rebuildTopicFromSources で組み直す", async () => {
    const docs = new Map<string, GraphiumDocument>();
    docs.set("wiki:t1", makeTopicDoc("t1", "AI3V格子熱伝導率", ["c1"]));
    docs.set("wiki:t2", makeTopicDoc("t2", "AI3V 格子熱伝導率", ["c2"]));
    docs.set("wiki:c1", makeClaimDoc("c1", "知見1", ["t1"]));
    docs.set("wiki:c2", makeClaimDoc("c2", "知見2", ["t2"]));
    // 旧形式のメンバー知見は derivedFromNotes に資料 id を持つ（rebuildTopicFromSources が拾う）
    docs.get("wiki:c1")!.wikiMeta!.derivedFromNotes = ["s1"];
    docs.get("wiki:c2")!.wikiMeta!.derivedFromNotes = ["s2"];

    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/consolidate-topics")) {
        return {
          ok: true,
          json: async () => ({ mapping: { "AI3V格子熱伝導率": "AI3V格子熱伝導率", "AI3V 格子熱伝導率": "AI3V格子熱伝導率" } }),
        };
      }
      if (String(url).includes("/revise-topic")) {
        return { ok: true, json: async () => ({ body: "## 定義\n統合後の本文" }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const existingTopics: ExistingTopicForMerge[] = [
      { id: "t1", title: "AI3V格子熱伝導率", memberClaimIds: ["c1"] },
      { id: "t2", title: "AI3V 格子熱伝導率", memberClaimIds: ["c2"] },
    ];
    const resolveSource = vi.fn(async (id: string) => ({ title: `資料${id}`, text: "本文" }));
    const deps = makeMergeDeps(docs, { resolveSource });
    const result = await consolidateExistingTopics(existingTopics, deps);

    expect(result).toMatchObject({ merged: 1, rebuilt: 1, failed: 0 });
    expect(deps.handleDeleteWikiFile).toHaveBeenCalledWith("t2");
    // 吸収元(c2)の claim 側 topicIds が統合先(t1)へ retarget されている
    const c2 = docs.get("wiki:c2");
    expect(c2?.wikiMeta?.topicIds).toEqual(["t1"]);
    // 統合先(t1)は資料から組み直され、新形式へ移行している
    const t1 = docs.get("wiki:t1");
    expect(t1?.wikiMeta?.topicMarkdown).toBeDefined();
    expect(t1?.wikiMeta?.derivedFromNotes).toEqual(["s1", "s2"]);
  });

  it("consolidate-topics が失敗したら何もしない（統合は最適化であって必須ではない）", async () => {
    const docs = new Map<string, GraphiumDocument>();
    docs.set("wiki:t1", makeTopicDoc("t1", "話題A", ["c1"]));
    docs.set("wiki:t2", makeTopicDoc("t2", "話題B", ["c2"]));

    (global.fetch as any).mockImplementation(async () => ({ ok: false, status: 500, text: async () => "{}" }));

    const existingTopics: ExistingTopicForMerge[] = [
      { id: "t1", title: "話題A", memberClaimIds: ["c1"] },
      { id: "t2", title: "話題B", memberClaimIds: ["c2"] },
    ];
    const deps = makeMergeDeps(docs);
    const result = await consolidateExistingTopics(existingTopics, deps);

    expect(result).toEqual({ merged: 0, rebuilt: 0, failed: 0 });
  });
});

describe("mergeTopicsExplicit", () => {
  // バナー・一覧・点検からの明示選択マージ。LLM（consolidate-topics）は呼ばない。
  const originalFetch = global.fetch;
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

  function makeMergeDeps(
    docs: Map<string, GraphiumDocument>,
    overrides: Partial<ConsolidateExistingTopicsDeps> = {},
  ): ConsolidateExistingTopicsDeps {
    return {
      loadDoc: vi.fn(async (id: string) => docs.get(id) ?? null),
      getCachedDoc: vi.fn((id: string) => docs.get(id) ?? null),
      handleSaveWikiFile: vi.fn(async (wikiId: string, doc: GraphiumDocument) => {
        docs.set(`wiki:${wikiId}`, doc);
        return true;
      }),
      handleDeleteWikiFile: vi.fn(async () => {}),
      resolveSource: vi.fn(async () => undefined),
      locale: "ja",
      log: vi.fn(),
      ...overrides,
    };
  }

  it("旧形式を含む場合: consolidate-topics（LLM）を呼ばずに、資料から rebuildTopicFromSources で組み直す", async () => {
    const docs = new Map<string, GraphiumDocument>();
    docs.set("wiki:t1", makeTopicDoc("t1", "焼結条件と粒成長", ["c1"]));
    docs.set("wiki:t2", makeTopicDoc("t2", "SPS 焼結の粒成長抑制", ["c2"]));
    docs.set("wiki:c1", makeClaimDoc("c1", "知見1", ["t1"]));
    docs.set("wiki:c2", makeClaimDoc("c2", "知見2", ["t2"]));
    docs.get("wiki:c1")!.wikiMeta!.derivedFromNotes = ["s1"];
    docs.get("wiki:c2")!.wikiMeta!.derivedFromNotes = ["s2"];

    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/revise-topic")) {
        return { ok: true, json: async () => ({ body: "## 定義\n統合後の本文" }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const existingTopics: ExistingTopicForMerge[] = [
      { id: "t1", title: "焼結条件と粒成長", memberClaimIds: ["c1"] },
      { id: "t2", title: "SPS 焼結の粒成長抑制", memberClaimIds: ["c2"] },
    ];
    const resolveSource = vi.fn(async (id: string) => ({ title: `資料${id}`, text: "本文" }));
    const deps = makeMergeDeps(docs, { resolveSource });
    const result = await mergeTopicsExplicit("t1", ["t2"], existingTopics, deps);

    expect(result).toMatchObject({ merged: 1, rebuilt: 1, failed: 0 });
    // consolidate-topics は呼ばれない（明示選択のみ・モデル不要）
    expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining("/consolidate-topics"), expect.anything());
    expect(deps.handleDeleteWikiFile).toHaveBeenCalledWith("t2");
    const c2 = docs.get("wiki:c2");
    expect(c2?.wikiMeta?.topicIds).toEqual(["t1"]);
    const t1 = docs.get("wiki:t1");
    expect(t1?.wikiMeta?.topicMarkdown).toBeDefined();
    expect(t1?.wikiMeta?.derivedFromNotes).toEqual(["s1", "s2"]);
  });

  it("全員新形式なら mergeTopicBodies で本文どうしを直接統合し、資料は全員の derivedFromNotes の和になる", async () => {
    const docs = new Map<string, GraphiumDocument>();
    docs.set("wiki:t1", makeSourceTopicDoc("焼結条件と粒成長", "## 定義\n本文1 [[source:s1]]", ["s1"]));
    docs.set("wiki:t2", makeSourceTopicDoc("SPS 焼結の粒成長抑制", "## 定義\n本文2 [[source:s2]]", ["s2"]));

    let mergeCalled: any;
    (global.fetch as any).mockImplementation(async (url: string, init: any) => {
      if (String(url).includes("/merge-topics")) {
        mergeCalled = JSON.parse(init.body);
        return { ok: true, json: async () => ({ body: "## 定義\n統合後の本文 [[source:s1]][[source:s2]]" }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const existingTopics: ExistingTopicForMerge[] = [
      { id: "t1", title: "焼結条件と粒成長", memberClaimIds: [] },
      { id: "t2", title: "SPS 焼結の粒成長抑制", memberClaimIds: [] },
    ];
    const resolveSourceTitle = vi.fn((id: string) => `資料${id}`);
    const deps = makeMergeDeps(docs, { resolveSourceTitle });
    const result = await mergeTopicsExplicit("t1", ["t2"], existingTopics, deps);

    expect(result).toMatchObject({ merged: 1, rebuilt: 1, failed: 0 });
    // 全員の本文が /merge-topics に渡っている
    expect(mergeCalled.bodies).toEqual(["## 定義\n本文1 [[source:s1]]", "## 定義\n本文2 [[source:s2]]"]);
    const t1 = docs.get("wiki:t1");
    expect(t1?.wikiMeta?.derivedFromNotes).toEqual(["s1", "s2"]);
    expect(deps.handleDeleteWikiFile).toHaveBeenCalledWith("t2");
  });

  it("keepId のみ渡す（mergeIds が空）なら何もしない", async () => {
    const docs = new Map<string, GraphiumDocument>();
    const deps = makeMergeDeps(docs);
    const existingTopics: ExistingTopicForMerge[] = [
      { id: "t1", title: "話題A", memberClaimIds: [] },
    ];
    const result = await mergeTopicsExplicit("t1", [], existingTopics, deps);
    expect(result).toEqual({ merged: 0, rebuilt: 0, failed: 0 });
    expect(deps.handleDeleteWikiFile).not.toHaveBeenCalled();
  });

  it("keepId 自身が mergeIds に混じっていても無視する（自己統合ガード）", async () => {
    const docs = new Map<string, GraphiumDocument>();
    docs.set("wiki:t1", makeTopicDoc("t1", "話題A", ["c1"]));
    docs.set("wiki:c1", makeClaimDoc("c1", "知見1", ["t1"]));
    const deps = makeMergeDeps(docs);
    const existingTopics: ExistingTopicForMerge[] = [
      { id: "t1", title: "話題A", memberClaimIds: ["c1"] },
    ];
    const result = await mergeTopicsExplicit("t1", ["t1"], existingTopics, deps);
    expect(result).toEqual({ merged: 0, rebuilt: 0, failed: 0 });
    expect(deps.handleDeleteWikiFile).not.toHaveBeenCalled();
  });
});

describe("isIngestInsufficient", () => {
  it("知見・トピックのどちらも 0 件なら true", () => {
    expect(isIngestInsufficient(0, 0)).toBe(true);
  });
  it("知見が 1 件以上あれば false", () => {
    expect(isIngestInsufficient(1, 0)).toBe(false);
  });
  it("知見が 0 件でもトピックが 1 件以上反映されていれば false", () => {
    expect(isIngestInsufficient(0, 1)).toBe(false);
  });
});
