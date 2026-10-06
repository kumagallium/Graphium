// 話題の段の Tier 1〜2 テスト。
// 資料から作る新形式トピック（runSourceTopicStage）とその周辺（統合・組み直し）を検証する。
// 知見（claim）はもうトピックの材料にしない（旧 runTopicStage は撤去済み）。
// reviseTopicFromSource / routeTopicsForSource 等は fetch 経由でサーバーを叩くので、
// このテストでは global.fetch をモックし、依存（fm 相当）もすべてスタブする。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  planExistingTopicMerges, consolidateExistingTopics, mergeTopicsExplicit, applyTopicMerges,
  type ExistingTopicForMerge, type ConsolidateExistingTopicsDeps,
  runSourceTopicStage, type SourceTopicStageDeps, type SourceTopicStageInput,
  rebuildTopicFromSources, type RebuildTopicFromSourcesDeps,
  planTopicRebuild, type TopicRebuildTarget,
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

/** 新形式 answer（回答ページ・topicMarkdown あり）のテスト用ドキュメント */
function makeSourceAnswerDoc(title: string, topicMarkdown: string, sourceIds: string[]): GraphiumDocument {
  const wikiMeta: WikiMeta = {
    kind: "answer",
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
    knowledgeSchema: "schema",
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

  it("振り分けがモデル未登録で断られたら、その理由（code 付き）を failureError に残す", async () => {
    const { deps } = makeSourceDeps();
    const refusal = { error: "No usable AI model was found.", code: "NO_MODEL_REGISTERED" };
    (global.fetch as any).mockImplementation(async () => ({
      ok: false, status: 400, json: async () => refusal, text: async () => JSON.stringify(refusal),
    }));

    const result = await runSourceTopicStage([{ id: "note-1", title: "資料", text: "本文" }], deps);
    expect(result).toMatchObject({ created: 0, updated: 0, failed: 1 });
    expect((result.failureError as Error & { code?: string }).code).toBe("NO_MODEL_REGISTERED");
  });

  it("改訂が断られたときも理由を残す（振り分けは通って新規作成の改訂で断られる）", async () => {
    const { deps } = makeSourceDeps();
    const refusal = { error: "No usable AI model was found.", code: "NO_MODEL_REGISTERED" };
    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/route-topics")) {
        return { ok: true, json: async () => ({ update: [], create: ["新トピック"] }) };
      }
      return { ok: false, status: 400, json: async () => refusal, text: async () => JSON.stringify(refusal) };
    });

    const result = await runSourceTopicStage([{ id: "note-1", title: "資料", text: "本文" }], deps);
    expect(result).toMatchObject({ created: 0, failed: 1 });
    expect((result.failureError as Error & { code?: string }).code).toBe("NO_MODEL_REGISTERED");
  });

  it("先に code の無い失敗が残っていても、あとから来たモデル未登録の断りに置き換える（直せる原因を見せる）", async () => {
    const { deps } = makeSourceDeps();
    const refusal = { error: "No usable AI model was found.", code: "NO_MODEL_REGISTERED" };
    let calls = 0;
    (global.fetch as any).mockImplementation(async () => {
      calls++;
      if (calls === 1) return { ok: false, status: 502, text: async () => "Bad gateway" };
      return { ok: false, status: 400, json: async () => refusal, text: async () => JSON.stringify(refusal) };
    });

    const result = await runSourceTopicStage([
      { id: "note-1", title: "資料1", text: "本文1" },
      { id: "note-2", title: "資料2", text: "本文2" },
    ], deps);
    expect(result).toMatchObject({ failed: 2 });
    expect((result.failureError as Error & { code?: string }).code).toBe("NO_MODEL_REGISTERED");
  });

  it("先にモデル未登録の断りが残っていれば、あとの code の無い失敗では置き換えない", async () => {
    const { deps } = makeSourceDeps();
    const refusal = { error: "No usable AI model was found.", code: "NO_MODEL_REGISTERED" };
    let calls = 0;
    (global.fetch as any).mockImplementation(async () => {
      calls++;
      if (calls === 1) return { ok: false, status: 400, json: async () => refusal, text: async () => JSON.stringify(refusal) };
      return { ok: false, status: 502, text: async () => "Bad gateway" };
    });

    const result = await runSourceTopicStage([
      { id: "note-1", title: "資料1", text: "本文1" },
      { id: "note-2", title: "資料2", text: "本文2" },
    ], deps);
    expect(result).toMatchObject({ failed: 2 });
    expect((result.failureError as Error & { code?: string }).code).toBe("NO_MODEL_REGISTERED");
  });

  it("失敗が無ければ failureError は入らない", async () => {
    const { deps } = makeSourceDeps();
    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/route-topics")) {
        return { ok: true, json: async () => ({ update: [], create: ["新トピック"] }) };
      }
      return { ok: true, json: async () => ({ body: "## 定義\n本文[[source:note-1]]" }) };
    });

    const result = await runSourceTopicStage([{ id: "note-1", title: "資料", text: "本文" }], deps);
    expect(result).toMatchObject({ created: 1, failed: 0 });
    expect(result.failureError).toBeUndefined();
  });

  it("今回の資料を既に引用済みのトピックは、ルーターの update に無くても改訂対象に含める", async () => {
    const { deps, docs } = makeSourceDeps({
      // ルーターはこのトピックを返さない（見落とし）が、sourceIds で既に引用済みと分かる。
      existingTopicRefs: [{ id: "topic-1", title: "既存トピック", sourceIds: ["note-1"] }],
    });
    docs.set("wiki:topic-1", makeSourceTopicDoc("既存トピック", "## 定義\n旧本文[[source:note-1]]", ["note-1"]));

    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/route-topics")) {
        return { ok: true, json: async () => ({ update: [], create: [] }) };
      }
      if (String(url).includes("/revise-topic")) {
        return { ok: true, json: async () => ({ body: "## 定義\n更新後の本文[[source:note-1]]" }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const sources: SourceTopicStageInput[] = [{ id: "note-1", title: "資料タイトル（更新後）", text: "更新後の本文" }];
    const result = await runSourceTopicStage(sources, deps);

    expect(result).toMatchObject({ created: 0, updated: 1, failed: 0 });
    const saved = docs.get("wiki:topic-1");
    expect(saved?.wikiMeta?.topicMarkdown).toContain("更新後の本文");
  });

  // レビュー確認用: surveySource が deps に渡されていても、窓 1 枚（4,000 字以下）の
  // 資料では呼ばれないこと・fetch も route-topics 1 回 + revise-topic 1 回だけであること。
  // decision 2「窓 1 枚に収まる資料は今と完全に同じ動き」を fetch 呼び出し回数で確認する。
  it("窓 1 枚の資料は surveySource が渡されていても呼ばれず、fetch も route 1 回 + revise 1 回だけ", async () => {
    const surveySource = vi.fn(async () => "見取り図テキスト");
    const { deps } = makeSourceDeps({ surveySource });

    let fetchCalls = 0;
    (global.fetch as any).mockImplementation(async (url: string) => {
      fetchCalls++;
      if (String(url).includes("/route-topics")) {
        return { ok: true, json: async () => ({ update: [], create: ["新トピック"] }) };
      }
      if (String(url).includes("/revise-topic")) {
        return { ok: true, json: async () => ({ body: "## 定義\n本文[[source:note-1]]" }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const sources: SourceTopicStageInput[] = [{ id: "note-1", title: "短い資料", text: "短い本文" }];
    await runSourceTopicStage(sources, deps);

    expect(surveySource).not.toHaveBeenCalled();
    expect(fetchCalls).toBe(2); // route-topics 1 回 + revise-topic 1 回
    expect(deps.handleCreateWikiFile).toHaveBeenCalledTimes(1);
    expect(deps.handleSaveWikiFile).not.toHaveBeenCalled(); // 新規作成のみ・改訂保存は別経路
  });

  // ── 窓分割（複数窓）── splitIntoWindows は 4,000 字超で複数窓に分ける。
  // ここでは長文を作り、見取り図・窓ごとの route/revise・保存回数を検証する。
  const LONG_TEXT = "あ".repeat(5000); // 窓 4,000 字・重ね 400 字なので窓 2 枚になる

  it("4,000 字を超える資料は見取り図 1 回 + 窓ごとの振り分け・改訂が呼ばれ、保存は 1 回", async () => {
    const surveySource = vi.fn(async () => "見取り図テキスト");
    const { deps, docs } = makeSourceDeps({ surveySource });

    let routeCalls = 0;
    let reviseCalls = 0;
    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/route-topics")) {
        routeCalls++;
        return { ok: true, json: async () => ({ update: [], create: ["新トピック"] }) };
      }
      if (String(url).includes("/revise-topic")) {
        reviseCalls++;
        return { ok: true, json: async () => ({ body: `## 定義\n本文${reviseCalls}[[source:note-1]]` }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const sources: SourceTopicStageInput[] = [{ id: "note-1", title: "長い資料", text: LONG_TEXT }];
    const result = await runSourceTopicStage(sources, deps);

    expect(surveySource).toHaveBeenCalledTimes(1);
    expect(routeCalls).toBe(2); // 窓ごとに 1 回
    expect(reviseCalls).toBe(2); // 窓 1: 新規作成 / 窓 2: 同名を更新として改訂
    expect(result.created).toBe(1);
    expect(deps.handleCreateWikiFile).toHaveBeenCalledTimes(1);
    // 作成後、窓 2 でさらに改訂されたので保存が 1 回だけ追加で走る（作成の保存とは別）
    expect(deps.handleSaveWikiFile).toHaveBeenCalledTimes(1);
    const created = docs.get(`wiki:${result.createdTopics[0].id}`);
    expect(created?.wikiMeta?.topicMarkdown).toContain("本文2");
  });

  // レビュー確認用: 窓 1 枚目で新規作成したトピックの id が、窓 2 枚目の route-topics 呼び出しの
  // existingTopics に実際に含まれること（decision 5「作成後は existingRefs に加える」の直接確認）。
  it("窓 1 枚目で新規作成したトピックは、窓 2 枚目の route-topics の existingTopics に含まれる", async () => {
    const { deps } = makeSourceDeps();

    const routeRequestBodies: any[] = [];
    let createdTopicId: string | undefined;
    (global.fetch as any).mockImplementation(async (url: string, init: any) => {
      if (String(url).includes("/route-topics")) {
        const parsedBody = JSON.parse(init.body);
        routeRequestBodies.push(parsedBody);
        // 窓 1 枚目（existingTopics に無題トピックが無い）は新規作成、窓 2 枚目は同じ名前を返す
        // （実装側が createdNames で二重作成せず、existingTopics 経由の存在確認とは別経路で
        // 重複を防いでいることは既存テストで確認済み。ここでは existingTopics の中身を見る）。
        return { ok: true, json: async () => ({ update: [], create: ["新トピック"] }) };
      }
      if (String(url).includes("/revise-topic")) {
        return { ok: true, json: async () => ({ body: "## 定義\n本文[[source:note-1]]" }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    (deps.handleCreateWikiFile as any).mockImplementation(async (doc: GraphiumDocument) => {
      createdTopicId = "new-topic-0";
      return createdTopicId;
    });

    const sources: SourceTopicStageInput[] = [{ id: "note-1", title: "長い資料", text: LONG_TEXT }];
    await runSourceTopicStage(sources, deps);

    expect(routeRequestBodies).toHaveLength(2);
    // 窓 1 枚目: まだ作成前なので existingTopics に含まれない
    expect(routeRequestBodies[0].existingTopics.map((t: any) => t.id)).not.toContain(createdTopicId);
    // 窓 2 枚目: 窓 1 枚目で作成済みの id が existingTopics に含まれる
    expect(routeRequestBodies[1].existingTopics.map((t: any) => t.id)).toContain(createdTopicId);
  });

  it("窓が複数のとき、2 枚目以降の窓では previouslyCited が false になる", async () => {
    const { deps, docs } = makeSourceDeps({
      existingTopicRefs: [{ id: "topic-1", title: "既存トピック", sourceIds: ["note-1"] }],
    });
    docs.set("wiki:topic-1", makeSourceTopicDoc("既存トピック", "## 定義\n旧本文[[source:note-1]]", ["note-1"]));

    const sentBodies: any[] = [];
    (global.fetch as any).mockImplementation(async (url: string, init: any) => {
      if (String(url).includes("/route-topics")) {
        return { ok: true, json: async () => ({ update: ["topic-1"], create: [] }) };
      }
      if (String(url).includes("/revise-topic")) {
        sentBodies.push(JSON.parse(init.body));
        return { ok: true, json: async () => ({ body: "## 定義\n更新後の本文[[source:note-1]]" }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const sources: SourceTopicStageInput[] = [{ id: "note-1", title: "資料（更新後）", text: LONG_TEXT }];
    await runSourceTopicStage(sources, deps);

    expect(sentBodies).toHaveLength(2);
    expect(sentBodies[0].previouslyCited).toBe(true); // 1 枚目: 実行前から引用済み
    expect(sentBodies[1].previouslyCited).toBeFalsy(); // 2 枚目以降は立てない
  });

  it("窓 2 枚目で中断されたら、そこで止まり 1 枚目までの本文が保存される", async () => {
    const { deps, docs } = makeSourceDeps();
    const controller = new AbortController();

    let reviseCalls = 0;
    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/route-topics")) {
        return { ok: true, json: async () => ({ update: [], create: ["新トピック"] }) };
      }
      if (String(url).includes("/revise-topic")) {
        reviseCalls++;
        // 窓 1 枚目の改訂が終わった直後に中断を発行する（窓ループの先頭で検出される）。
        if (reviseCalls === 1) controller.abort();
        return { ok: true, json: async () => ({ body: `## 定義\n窓${reviseCalls}の本文[[source:note-1]]` }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const sources: SourceTopicStageInput[] = [{ id: "note-1", title: "長い資料", text: LONG_TEXT }];
    const result = await runSourceTopicStage(sources, { ...deps, signal: controller.signal });

    expect(reviseCalls).toBe(1); // 窓 2 枚目には入らない
    expect(result.created).toBe(1);
    const created = docs.get(`wiki:${result.createdTopics[0].id}`);
    expect(created?.wikiMeta?.topicMarkdown).toContain("窓1の本文");
  });

  it("中断は失敗に数えない（実行中の振り分けが AbortError で落ちても failed は増えない）", async () => {
    const { deps } = makeSourceDeps();
    const controller = new AbortController();

    let routeCalls = 0;
    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/route-topics")) {
        routeCalls++;
        if (routeCalls === 1) return { ok: true, json: async () => ({ update: [], create: [] }) };
        // 2 枚目の窓の振り分け中にユーザーが停止した状況（fetch が AbortError で落ちる）。
        controller.abort();
        throw new DOMException("aborted", "AbortError");
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const sources: SourceTopicStageInput[] = [{ id: "note-1", title: "長い資料", text: LONG_TEXT }];
    const result = await runSourceTopicStage(sources, { ...deps, signal: controller.signal });

    expect(result.failed).toBe(0);
    expect(routeCalls).toBe(2); // 2 枚目で止まり、3 枚目には進まない
  });

  it("窓 1 枚の資料でも、振り分け・改訂の fetch に中断シグナルを渡す", async () => {
    const { deps } = makeSourceDeps();
    const controller = new AbortController();
    const signals: { url: string; signal: unknown }[] = [];
    (global.fetch as any).mockImplementation(async (url: string, init: any) => {
      signals.push({ url: String(url), signal: init?.signal });
      if (String(url).includes("/route-topics")) {
        return { ok: true, json: async () => ({ update: [], create: ["新トピック"] }) };
      }
      if (String(url).includes("/revise-topic")) {
        return { ok: true, json: async () => ({ body: "## 定義\n本文[[source:note-1]]" }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const sources: SourceTopicStageInput[] = [{ id: "note-1", title: "短い資料", text: "短い本文" }];
    await runSourceTopicStage(sources, { ...deps, signal: controller.signal });

    expect(signals.map((s) => s.url.split("/").pop())).toEqual(["route-topics", "revise-topic"]);
    for (const s of signals) expect(s.signal).toBe(controller.signal);
  });

  it("窓 1 枚の資料を処理中に停止したら、次の資料に入らず失敗にも数えない", async () => {
    const { deps } = makeSourceDeps();
    const controller = new AbortController();
    const routedSources: string[] = [];
    (global.fetch as any).mockImplementation(async (url: string, init: any) => {
      if (String(url).includes("/route-topics")) {
        routedSources.push(JSON.parse(init.body).source.id);
        return { ok: true, json: async () => ({ update: [], create: ["新トピック"] }) };
      }
      if (String(url).includes("/revise-topic")) {
        // 1 本目の資料の改訂中にユーザーが停止した状況（fetch が AbortError で落ちる）
        controller.abort();
        throw new DOMException("aborted", "AbortError");
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const sources: SourceTopicStageInput[] = [
      { id: "note-1", title: "短い資料 1", text: "短い本文 1" },
      { id: "note-2", title: "短い資料 2", text: "短い本文 2" },
    ];
    const result = await runSourceTopicStage(sources, { ...deps, signal: controller.signal });

    expect(routedSources).toEqual(["note-1"]);
    expect(result.failed).toBe(0);
    expect(result.failureError).toBeUndefined();
    expect(result.created).toBe(0);
  });

  it("窓が複数トピックに振り分けられても、改訂回数は窓ごとに route が返したトピック分だけ", async () => {
    const { deps, docs } = makeSourceDeps({
      existingTopicRefs: [
        { id: "topic-a", title: "トピックA" },
        { id: "topic-b", title: "トピックB" },
      ],
    });
    docs.set("wiki:topic-a", makeSourceTopicDoc("トピックA", "## 定義\nA旧本文", []));
    docs.set("wiki:topic-b", makeSourceTopicDoc("トピックB", "## 定義\nB旧本文", []));

    let routeCalls = 0;
    let reviseCalls = 0;
    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/route-topics")) {
        routeCalls++;
        // 窓 1 は topic-a だけ、窓 2 は topic-a・topic-b 両方を返す
        // （もし窓数×トピック数で回るなら 2×2=4 回になるはずが、そうならないことを確認する）。
        return routeCalls === 1
          ? { ok: true, json: async () => ({ update: ["topic-a"], create: [] }) }
          : { ok: true, json: async () => ({ update: ["topic-a", "topic-b"], create: [] }) };
      }
      if (String(url).includes("/revise-topic")) {
        reviseCalls++;
        return { ok: true, json: async () => ({ body: `## 定義\n改訂${reviseCalls}` }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const sources: SourceTopicStageInput[] = [{ id: "note-1", title: "資料", text: LONG_TEXT }];
    const result = await runSourceTopicStage(sources, deps);

    // 窓 1: topic-a のみ改訂（1 回）/ 窓 2: topic-a・topic-b を改訂（2 回）= 合計 3 回。
    // 窓数×トピック数（2×2=4）にはならない — 窓ごとに route が実際に返した分だけ。
    expect(reviseCalls).toBe(3);
    expect(result.updated).toBe(2); // topic-a・topic-b それぞれ 1 回だけ保存（窓ごとではない）
    expect(deps.handleSaveWikiFile).toHaveBeenCalledTimes(2);
    const savedA = docs.get("wiki:topic-a");
    expect(savedA?.wikiMeta?.topicMarkdown).toContain("改訂2"); // 最終窓（窓2）の本文が保存される
  });

  it("引用済みトピックの改訂では、previouslyCited フラグ付きでユーザーメッセージに再確認の指示が入る", async () => {
    const { deps, docs } = makeSourceDeps({
      existingTopicRefs: [{ id: "topic-1", title: "既存トピック", sourceIds: ["note-1"] }],
    });
    docs.set("wiki:topic-1", makeSourceTopicDoc("既存トピック", "## 定義\n旧本文[[source:note-1]]", ["note-1"]));

    let sentBody: any;
    (global.fetch as any).mockImplementation(async (url: string, init: any) => {
      if (String(url).includes("/route-topics")) {
        return { ok: true, json: async () => ({ update: [], create: [] }) };
      }
      if (String(url).includes("/revise-topic")) {
        sentBody = JSON.parse(init.body);
        return { ok: true, json: async () => ({ body: "## 定義\n更新後の本文[[source:note-1]]" }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const sources: SourceTopicStageInput[] = [{ id: "note-1", title: "資料タイトル（更新後）", text: "更新後の本文" }];
    await runSourceTopicStage(sources, deps);

    expect(sentBody.previouslyCited).toBe(true);
  });

  it("answer（回答ページ）はルーターに渡す既存一覧に kind: answer 付きで載る", async () => {
    const { deps, docs } = makeSourceDeps({
      existingTopicRefs: [{ id: "answer-1", title: "この現象はなぜ起きますか？", kind: "answer" }],
    });
    docs.set("wiki:answer-1", makeSourceAnswerDoc("この現象はなぜ起きますか？", "## 回答\n本文[[source:note-0]]", ["note-0"]));

    let routeBody: any;
    (global.fetch as any).mockImplementation(async (url: string, init: any) => {
      if (String(url).includes("/route-topics")) {
        routeBody = JSON.parse(init.body);
        return { ok: true, json: async () => ({ update: [], create: [] }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const sources: SourceTopicStageInput[] = [{ id: "note-1", title: "新しい資料", text: "新しい資料の本文" }];
    await runSourceTopicStage(sources, deps);

    expect(routeBody.existingTopics).toEqual([
      expect.objectContaining({ id: "answer-1", kind: "answer" }),
    ]);
  });

  it("引用済みの answer は、ルーターが update に選ばなくても改訂対象に含める（トピックと同じ規則）", async () => {
    const { deps, docs } = makeSourceDeps({
      existingTopicRefs: [{ id: "answer-1", title: "問い", sourceIds: ["note-1"], kind: "answer" }],
    });
    docs.set("wiki:answer-1", makeSourceAnswerDoc("問い", "## 回答\n旧本文[[source:note-1]]", ["note-1"]));

    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/route-topics")) {
        return { ok: true, json: async () => ({ update: [], create: [] }) };
      }
      if (String(url).includes("/revise-topic")) {
        return { ok: true, json: async () => ({ body: "## 回答\n更新後の本文[[source:note-1]]" }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const sources: SourceTopicStageInput[] = [{ id: "note-1", title: "資料（更新後）", text: "更新後の本文" }];
    const result = await runSourceTopicStage(sources, deps);

    expect(result).toMatchObject({ created: 0, updated: 1, failed: 0 });
    const saved = docs.get("wiki:answer-1");
    expect(saved?.wikiMeta?.kind).toBe("answer");
    expect(saved?.wikiMeta?.topicMarkdown).toContain("更新後の本文");
  });

  it("新規作成（route-topics の create）では answer は作られない — 常に topic として作る", async () => {
    const { deps } = makeSourceDeps();
    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/route-topics")) {
        return { ok: true, json: async () => ({ update: [], create: ["新しい話題"] }) };
      }
      if (String(url).includes("/revise-topic")) {
        return { ok: true, json: async () => ({ body: "## 定義\n本文[[source:note-1]]" }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const sources: SourceTopicStageInput[] = [{ id: "note-1", title: "資料", text: "本文" }];
    await runSourceTopicStage(sources, deps);

    const [createdDoc] = (deps.handleCreateWikiFile as any).mock.calls[0];
    expect(createdDoc.wikiMeta.kind).toBe("topic");
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
      knowledgeSchema: "schema",
      log: vi.fn(),
    };

    const result = await rebuildTopicFromSources("topic-1", ["missing-note", "ok-note"], deps);
    expect(result).toMatchObject({ rebuilt: true, sourcesUsed: 1, sourcesSkipped: 1 });
    expect(docs.get("wiki:topic-1")?.wikiMeta?.derivedFromNotes).toEqual(["ok-note"]);
  });

  // レビュー確認用: 資料本文が 4,000 字を超えたら rebuildTopicFromSources 自身も
  // splitIntoWindows を通し、見取り図 1 回 + 窓ごとの改訂を重ね、保存はトピック全体で 1 回だけ
  // であること（作業 G 「既存の rebuildTopicFromSources も同じ窓分割を通す」の確認）。
  it("長い資料は見取り図 1 回 + 窓ごとの改訂を重ね、保存は 1 回だけ", async () => {
    const { docs } = makeSourceDeps();
    docs.set("wiki:topic-1", makeSourceTopicDoc("トピック", "", []));
    const longText = "あ".repeat(5000); // 窓 2 枚になる

    let reviseCalls = 0;
    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/revise-topic")) {
        reviseCalls++;
        return { ok: true, json: async () => ({ body: `## 定義\n改訂${reviseCalls}[[source:note-1]]` }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const surveySource = vi.fn(async () => "見取り図テキスト");
    const handleSaveWikiFile = vi.fn(async (wikiId: string, doc: GraphiumDocument) => {
      docs.set(`wiki:${wikiId}`, doc);
      return true;
    });
    const deps: RebuildTopicFromSourcesDeps = {
      loadDoc: vi.fn(async (id: string) => docs.get(id) ?? null),
      getCachedDoc: vi.fn((id: string) => docs.get(id) ?? null),
      handleSaveWikiFile,
      resolveSource: vi.fn(async () => ({ title: "長い資料", text: longText })),
      surveySource,
      locale: "ja",
      knowledgeSchema: "schema",
      log: vi.fn(),
    };

    const result = await rebuildTopicFromSources("topic-1", ["note-1"], deps);

    expect(surveySource).toHaveBeenCalledTimes(1);
    expect(reviseCalls).toBe(2); // 窓ごとに改訂を重ねる
    expect(handleSaveWikiFile).toHaveBeenCalledTimes(1); // 保存はトピック全体で 1 回だけ
    expect(result).toMatchObject({ rebuilt: true, sourcesUsed: 1, sourcesSkipped: 0 });
    expect(docs.get("wiki:topic-1")?.wikiMeta?.topicMarkdown).toContain("改訂2"); // 最終窓の本文
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
      knowledgeSchema: "schema",
    };
    const result = await rebuildTopicFromSources("topic-1", ["a", "b"], deps);
    expect(result).toEqual({ rebuilt: false, sourcesUsed: 0, sourcesSkipped: 2 });
  });

  it("改訂が断られて作り直せなかったら、その理由を failureError に残す", async () => {
    const { docs } = makeSourceDeps();
    docs.set("wiki:topic-1", makeSourceTopicDoc("トピック", "## 定義\n旧本文", ["a"]));
    const refusal = { error: "No usable AI model was found.", code: "NO_MODEL_REGISTERED" };
    (global.fetch as any).mockImplementation(async () => ({
      ok: false, status: 400, json: async () => refusal, text: async () => JSON.stringify(refusal),
    }));
    const deps: RebuildTopicFromSourcesDeps = {
      loadDoc: vi.fn(async (id: string) => docs.get(id) ?? null),
      getCachedDoc: vi.fn((id: string) => docs.get(id) ?? null),
      handleSaveWikiFile: vi.fn(async () => true),
      resolveSource: vi.fn(async () => ({ title: "資料A", text: "本文" })),
      locale: "ja",
      knowledgeSchema: "schema",
    };
    const result = await rebuildTopicFromSources("topic-1", ["a"], deps);
    expect(result).toMatchObject({ rebuilt: false, sourcesUsed: 0, sourcesSkipped: 1 });
    expect((result.failureError as Error & { code?: string }).code).toBe("NO_MODEL_REGISTERED");
  });

  it("一部の資料だけ断られて作り直せたときも、飛ばした件数と理由を返す", async () => {
    const { docs } = makeSourceDeps();
    docs.set("wiki:topic-1", makeSourceTopicDoc("トピック", "## 定義\n旧本文", ["a", "b"]));
    const refusal = { error: "Provider API error (429): rate limited" };
    let calls = 0;
    (global.fetch as any).mockImplementation(async () => {
      calls++;
      if (calls === 1) return { ok: false, status: 429, json: async () => refusal, text: async () => JSON.stringify(refusal) };
      return { ok: true, json: async () => ({ body: "## 定義\n資料Bから組み直した本文" }) };
    });
    const deps: RebuildTopicFromSourcesDeps = {
      loadDoc: vi.fn(async (id: string) => docs.get(id) ?? null),
      getCachedDoc: vi.fn((id: string) => docs.get(id) ?? null),
      handleSaveWikiFile: vi.fn(async () => true),
      resolveSource: vi.fn(async (id: string) => ({ title: `資料${id.toUpperCase()}`, text: "本文" })),
      locale: "ja",
      knowledgeSchema: "schema",
    };
    const result = await rebuildTopicFromSources("topic-1", ["a", "b"], deps);
    expect(result).toMatchObject({ rebuilt: true, sourcesUsed: 1, sourcesSkipped: 1 });
    expect((result.failureError as Error).message).toBe("Provider API error (429): rate limited");
  });

  it("ユーザーの停止（AbortError）は失敗の理由に残さない", async () => {
    const { docs } = makeSourceDeps();
    docs.set("wiki:topic-1", makeSourceTopicDoc("トピック", "## 定義\n旧本文", ["a"]));
    (global.fetch as any).mockImplementation(async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    const deps: RebuildTopicFromSourcesDeps = {
      loadDoc: vi.fn(async (id: string) => docs.get(id) ?? null),
      getCachedDoc: vi.fn((id: string) => docs.get(id) ?? null),
      handleSaveWikiFile: vi.fn(async () => true),
      resolveSource: vi.fn(async () => ({ title: "資料A", text: "本文" })),
      locale: "ja",
      knowledgeSchema: "schema",
    };
    const result = await rebuildTopicFromSources("topic-1", ["a"], deps);
    expect(result.rebuilt).toBe(false);
    expect(result.failureError).toBeUndefined();
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
      knowledgeSchema: "schema",
    };
    const result = await rebuildTopicFromSources("claim-1", ["a"], deps);
    expect(result).toEqual({ rebuilt: false, sourcesUsed: 0, sourcesSkipped: 1 });
  });

  it("answer（回答ページ）も組み直せる。kind は answer のまま保たれる", async () => {
    const { docs } = makeSourceDeps();
    docs.set("wiki:answer-1", makeSourceAnswerDoc("問い", "", []));
    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/revise-topic")) {
        return { ok: true, json: async () => ({ body: "## 回答\n本文[[source:note-a]]" }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const deps: RebuildTopicFromSourcesDeps = {
      loadDoc: vi.fn(async (id: string) => docs.get(id) ?? null),
      getCachedDoc: vi.fn((id: string) => docs.get(id) ?? null),
      handleSaveWikiFile: vi.fn(async (wikiId: string, doc: GraphiumDocument) => {
        docs.set(`wiki:${wikiId}`, doc);
        return true;
      }),
      resolveSource: vi.fn(async () => ({ title: "資料", text: "本文" })),
      locale: "ja",
      knowledgeSchema: "schema",
    };
    const result = await rebuildTopicFromSources("answer-1", ["note-a"], deps);
    expect(result.rebuilt).toBe(true);
    expect(docs.get("wiki:answer-1")?.wikiMeta?.kind).toBe("answer");
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
      knowledgeSchema: "schema",
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

    expect(result).toMatchObject({ merged: 0, rebuilt: 0, failed: 0 });
    // 何もしないが、断られた理由は残す（呼び出し側が「統合 0 件」を完了として見せないように）
    expect(result.failureError).toBeInstanceOf(Error);
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
      knowledgeSchema: "schema",
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

    const reviseBodies: any[] = [];
    (global.fetch as any).mockImplementation(async (url: string, init: any) => {
      if (String(url).includes("/revise-topic")) {
        reviseBodies.push(JSON.parse(init.body));
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
    // 組み直しの改訂にも Knowledge Schema が届く（無いとサーバーが 400 で断る）
    expect(reviseBodies.length).toBeGreaterThan(0);
    for (const body of reviseBodies) expect(body.knowledgeSchema).toBe("schema");
    expect(deps.handleDeleteWikiFile).toHaveBeenCalledWith("t2");
    const c2 = docs.get("wiki:c2");
    expect(c2?.wikiMeta?.topicIds).toEqual(["t1"]);
    const t1 = docs.get("wiki:t1");
    expect(t1?.wikiMeta?.topicMarkdown).toBeDefined();
    expect(t1?.wikiMeta?.derivedFromNotes).toEqual(["s1", "s2"]);
  });

  it("旧形式の知見の付け替え保存が例外: その吸収元はゴミ箱へ送らず failed に数え、ほかの吸収元は処理する", async () => {
    const docs = new Map<string, GraphiumDocument>();
    docs.set("wiki:t1", makeTopicDoc("t1", "焼結条件と粒成長", ["c1"]));
    docs.set("wiki:t2", makeTopicDoc("t2", "SPS 焼結の粒成長抑制", ["c2"]));
    docs.set("wiki:t3", makeTopicDoc("t3", "焼結の粒成長", ["c3"]));
    docs.set("wiki:c1", makeClaimDoc("c1", "知見1", ["t1"]));
    docs.set("wiki:c2", makeClaimDoc("c2", "知見2", ["t2"]));
    docs.set("wiki:c3", makeClaimDoc("c3", "知見3", ["t3"]));
    for (const [c, s] of [["c1", "s1"], ["c2", "s2"], ["c3", "s3"]]) docs.get(`wiki:${c}`)!.wikiMeta!.derivedFromNotes = [s];

    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/revise-topic")) {
        return { ok: true, json: async () => ({ body: "## 定義\n統合後の本文" }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const existingTopics: ExistingTopicForMerge[] = [
      { id: "t1", title: "焼結条件と粒成長", memberClaimIds: ["c1"] },
      { id: "t2", title: "SPS 焼結の粒成長抑制", memberClaimIds: ["c2"] },
      { id: "t3", title: "焼結の粒成長", memberClaimIds: ["c3"] },
    ];
    const deps = makeMergeDeps(docs, {
      resolveSource: vi.fn(async (id: string) => ({ title: `資料${id}`, text: "本文" })),
    });
    const baseSave = deps.handleSaveWikiFile;
    deps.handleSaveWikiFile = vi.fn(async (wikiId: string, doc: GraphiumDocument, opts?: any) => {
      if (wikiId === "c2") throw new Error("save failed");
      return baseSave(wikiId, doc, opts);
    });
    const result = await mergeTopicsExplicit("t1", ["t2", "t3"], existingTopics, deps);

    expect(result.failed).toBe(1);
    expect(result.merged).toBe(1);
    expect(deps.handleDeleteWikiFile).not.toHaveBeenCalledWith("t2");
    expect(deps.handleDeleteWikiFile).toHaveBeenCalledWith("t3");
    expect(docs.get("wiki:c2")?.wikiMeta?.topicIds).toEqual(["t2"]);
  });

  it("本文が 200 で空のまま返っても、理由を残して失敗に数える（将来のサーバー実装への備え）", async () => {
    const docs = new Map<string, GraphiumDocument>();
    docs.set("wiki:t1", makeTopicDoc("t1", "焼結条件と粒成長", ["c1"]));
    docs.set("wiki:t2", makeTopicDoc("t2", "SPS 焼結の粒成長抑制", ["c2"]));
    docs.set("wiki:c1", makeClaimDoc("c1", "知見1", ["t1"]));
    docs.set("wiki:c2", makeClaimDoc("c2", "知見2", ["t2"]));
    docs.get("wiki:c1")!.wikiMeta!.derivedFromNotes = ["s1"];
    docs.get("wiki:c2")!.wikiMeta!.derivedFromNotes = ["s2"];

    // 今のサーバーは本文が空なら 500 で断るが、将来 200 で空本文を返す実装に変わっても
    // 理由を残さず黙って失敗させないことを確かめる
    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/revise-topic")) {
        return { ok: true, json: async () => ({ body: "" }) };
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

    expect(result).toMatchObject({ merged: 1, rebuilt: 0, failed: 1 });
    expect(result.failureError).toBeInstanceOf(Error);
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
    // Knowledge Schema も届く（無いとサーバーが 400 で断る）
    expect(mergeCalled.knowledgeSchema).toBe("schema");
    const t1 = docs.get("wiki:t1");
    expect(t1?.wikiMeta?.derivedFromNotes).toEqual(["s1", "s2"]);
    expect(deps.handleDeleteWikiFile).toHaveBeenCalledWith("t2");
  });

  it("全員新形式で本文の統合に失敗したら、吸収される側をゴミ箱へ送らず、どちらのページも元のまま残す", async () => {
    const docs = new Map<string, GraphiumDocument>();
    docs.set("wiki:t1", makeSourceTopicDoc("焼結条件と粒成長", "## 定義\n本文1 [[source:s1]]", ["s1"]));
    docs.set("wiki:t2", makeSourceTopicDoc("SPS 焼結の粒成長抑制", "## 定義\n本文2 [[source:s2]]", ["s2"]));

    // サーバーが断る（以前の Knowledge Schema の渡し忘れと同じ 400）
    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/merge-topics")) {
        const error = { error: "knowledgeSchema is required" };
        return { ok: false, status: 400, json: async () => error, text: async () => JSON.stringify(error) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const existingTopics: ExistingTopicForMerge[] = [
      { id: "t1", title: "焼結条件と粒成長", memberClaimIds: [] },
      { id: "t2", title: "SPS 焼結の粒成長抑制", memberClaimIds: [] },
    ];
    const deps = makeMergeDeps(docs);
    const result = await mergeTopicsExplicit("t1", ["t2"], existingTopics, deps);

    expect(result).toMatchObject({ merged: 0, rebuilt: 0, failed: 1 });
    // 断られた理由も残る（トーストに添える）
    expect((result.failureError as Error).message).toBe("knowledgeSchema is required");
    expect(deps.handleDeleteWikiFile).not.toHaveBeenCalled();
    expect(deps.handleSaveWikiFile).not.toHaveBeenCalled();
    expect(docs.get("wiki:t1")?.wikiMeta?.topicMarkdown).toBe("## 定義\n本文1 [[source:s1]]");
    expect(docs.get("wiki:t1")?.wikiMeta?.derivedFromNotes).toEqual(["s1"]);
  });

  it("全員新形式で本文が 200 で空のまま返っても、理由を残して失敗に数える（将来のサーバー実装への備え）", async () => {
    const docs = new Map<string, GraphiumDocument>();
    docs.set("wiki:t1", makeSourceTopicDoc("焼結条件と粒成長", "## 定義\n本文1 [[source:s1]]", ["s1"]));
    docs.set("wiki:t2", makeSourceTopicDoc("SPS 焼結の粒成長抑制", "## 定義\n本文2 [[source:s2]]", ["s2"]));

    // 今のサーバーは本文が空なら 500 で断るが、将来 200 で空本文を返す実装に変わっても
    // 理由を残さず黙って失敗させないことを確かめる
    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/merge-topics")) {
        return { ok: true, json: async () => ({ body: "" }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const existingTopics: ExistingTopicForMerge[] = [
      { id: "t1", title: "焼結条件と粒成長", memberClaimIds: [] },
      { id: "t2", title: "SPS 焼結の粒成長抑制", memberClaimIds: [] },
    ];
    const deps = makeMergeDeps(docs);
    const result = await mergeTopicsExplicit("t1", ["t2"], existingTopics, deps);

    expect(result).toMatchObject({ merged: 0, rebuilt: 0, failed: 1 });
    expect(result.failureError).toBeInstanceOf(Error);
    expect(deps.handleDeleteWikiFile).not.toHaveBeenCalled();
  });

  it("旧形式を含む経路は、組み直しに失敗しても従来どおり吸収される側をゴミ箱へ送る（知見は付け替え済み）", async () => {
    const docs = new Map<string, GraphiumDocument>();
    docs.set("wiki:t1", makeTopicDoc("t1", "焼結条件と粒成長", ["c1"]));
    docs.set("wiki:t2", makeTopicDoc("t2", "SPS 焼結の粒成長抑制", ["c2"]));
    docs.set("wiki:c1", makeClaimDoc("c1", "知見1", ["t1"]));
    docs.set("wiki:c2", makeClaimDoc("c2", "知見2", ["t2"]));
    docs.get("wiki:c1")!.wikiMeta!.derivedFromNotes = ["s1"];
    docs.get("wiki:c2")!.wikiMeta!.derivedFromNotes = ["s2"];

    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/revise-topic")) {
        return { ok: false, status: 500, json: async () => ({}), text: async () => "{}" };
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

    expect(result).toMatchObject({ merged: 1, rebuilt: 0, failed: 1 });
    expect(result.failureError).toBeInstanceOf(Error);
    expect(deps.handleDeleteWikiFile).toHaveBeenCalledWith("t2");
    expect(docs.get("wiki:c2")?.wikiMeta?.topicIds).toEqual(["t1"]);
  });

  it("残す側が旧形式・吸収される側が新形式で組み直しに失敗したら、新形式の吸収元はゴミ箱へ送らず残す", async () => {
    const docs = new Map<string, GraphiumDocument>();
    docs.set("wiki:t1", makeTopicDoc("t1", "焼結条件と粒成長", ["c1"]));
    docs.set("wiki:c1", makeClaimDoc("c1", "知見1", ["t1"]));
    docs.get("wiki:c1")!.wikiMeta!.derivedFromNotes = ["s1"];
    docs.set("wiki:t2", makeSourceTopicDoc("SPS 焼結の粒成長抑制", "## 定義\n本文2 [[source:s2]]", ["s2"]));

    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/revise-topic")) {
        return { ok: false, status: 500, json: async () => ({}), text: async () => "{}" };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const existingTopics: ExistingTopicForMerge[] = [
      { id: "t1", title: "焼結条件と粒成長", memberClaimIds: ["c1"] },
      { id: "t2", title: "SPS 焼結の粒成長抑制", memberClaimIds: [] },
    ];
    const resolveSource = vi.fn(async (id: string) => ({ title: `資料${id}`, text: "本文" }));
    const deps = makeMergeDeps(docs, { resolveSource });
    const result = await mergeTopicsExplicit("t1", ["t2"], existingTopics, deps);

    expect(result).toMatchObject({ merged: 0, rebuilt: 0, failed: 1 });
    expect(deps.handleDeleteWikiFile).not.toHaveBeenCalled();
    // 新形式の吸収元は本文がどちらのページにも入っていないので、元のまま残っている
    expect(docs.get("wiki:t2")?.wikiMeta?.topicMarkdown).toBe("## 定義\n本文2 [[source:s2]]");
  });

  it("残す側が新形式・吸収される側に新旧が混ざり組み直しに失敗したら、新形式は残り旧形式はゴミ箱へ送る", async () => {
    const docs = new Map<string, GraphiumDocument>();
    docs.set("wiki:t1", makeSourceTopicDoc("焼結条件と粒成長", "## 定義\n本文1 [[source:s1]]", ["s1"]));
    docs.set("wiki:t2", makeSourceTopicDoc("SPS 焼結の粒成長抑制", "## 定義\n本文2 [[source:s2]]", ["s2"]));
    docs.set("wiki:t3", makeTopicDoc("t3", "粒成長の抑制機構", ["c3"]));
    docs.set("wiki:c3", makeClaimDoc("c3", "知見3", ["t3"]));
    docs.get("wiki:c3")!.wikiMeta!.derivedFromNotes = ["s3"];

    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/revise-topic")) {
        return { ok: false, status: 500, json: async () => ({}), text: async () => "{}" };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const existingTopics: ExistingTopicForMerge[] = [
      { id: "t1", title: "焼結条件と粒成長", memberClaimIds: [] },
      { id: "t2", title: "SPS 焼結の粒成長抑制", memberClaimIds: [] },
      { id: "t3", title: "粒成長の抑制機構", memberClaimIds: ["c3"] },
    ];
    const resolveSource = vi.fn(async (id: string) => ({ title: `資料${id}`, text: "本文" }));
    const deps = makeMergeDeps(docs, { resolveSource });
    const result = await mergeTopicsExplicit("t1", ["t2", "t3"], existingTopics, deps);

    expect(result).toMatchObject({ merged: 1, rebuilt: 0, failed: 1 });
    expect(deps.handleDeleteWikiFile).toHaveBeenCalledWith("t3");
    expect(deps.handleDeleteWikiFile).not.toHaveBeenCalledWith("t2");
    // 新形式の吸収元（t2）は元のまま残っている
    expect(docs.get("wiki:t2")?.wikiMeta?.topicMarkdown).toBe("## 定義\n本文2 [[source:s2]]");
    // 旧形式の吸収元（t3）の知見は統合先へ付け替え済み
    expect(docs.get("wiki:c3")?.wikiMeta?.topicIds).toEqual(["t1"]);
  });

  it("新旧が混ざった組で組み直しが成功したら、従来どおり吸収元を全員ゴミ箱へ送る", async () => {
    const docs = new Map<string, GraphiumDocument>();
    docs.set("wiki:t1", makeSourceTopicDoc("焼結条件と粒成長", "## 定義\n本文1 [[source:s1]]", ["s1"]));
    docs.set("wiki:t2", makeSourceTopicDoc("SPS 焼結の粒成長抑制", "## 定義\n本文2 [[source:s2]]", ["s2"]));
    docs.set("wiki:t3", makeTopicDoc("t3", "粒成長の抑制機構", ["c3"]));
    docs.set("wiki:c3", makeClaimDoc("c3", "知見3", ["t3"]));
    docs.get("wiki:c3")!.wikiMeta!.derivedFromNotes = ["s3"];

    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/revise-topic")) {
        return { ok: true, json: async () => ({ body: "## 定義\n統合後の本文" }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const existingTopics: ExistingTopicForMerge[] = [
      { id: "t1", title: "焼結条件と粒成長", memberClaimIds: [] },
      { id: "t2", title: "SPS 焼結の粒成長抑制", memberClaimIds: [] },
      { id: "t3", title: "粒成長の抑制機構", memberClaimIds: ["c3"] },
    ];
    const resolveSource = vi.fn(async (id: string) => ({ title: `資料${id}`, text: "本文" }));
    const deps = makeMergeDeps(docs, { resolveSource });
    const result = await mergeTopicsExplicit("t1", ["t2", "t3"], existingTopics, deps);

    expect(result).toMatchObject({ merged: 2, rebuilt: 1, failed: 0 });
    expect(deps.handleDeleteWikiFile).toHaveBeenCalledWith("t2");
    expect(deps.handleDeleteWikiFile).toHaveBeenCalledWith("t3");
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

describe("planTopicRebuild", () => {
  it("新形式トピックは derivedFromNotes をそのまま資料とみなす", async () => {
    const doc = makeSourceTopicDoc("トピック", "本文", ["note-1", "note-2"]);
    const targets: TopicRebuildTarget[] = [{ id: "topic-1", doc }];
    const plan = await planTopicRebuild(targets, async () => null);
    expect(plan).toEqual({
      items: [{ topicId: "topic-1", sourceIds: ["note-1", "note-2"] }],
      topicCount: 1,
      totalCalls: 2,
    });
  });

  it("旧形式トピックはメンバー知見の derivedFromNotes の和を重複除去して資料とみなす", async () => {
    const claimDocs = new Map<string, GraphiumDocument>();
    const claimA = makeClaimDoc("claim-a", "知見A");
    claimA.wikiMeta!.derivedFromNotes = ["note-1", "note-2"];
    const claimB = makeClaimDoc("claim-b", "知見B");
    claimB.wikiMeta!.derivedFromNotes = ["note-2", "note-3"];
    claimDocs.set("wiki:claim-a", claimA);
    claimDocs.set("wiki:claim-b", claimB);

    const topicDoc = makeTopicDoc("topic-1", "トピック", ["claim-a", "claim-b"]);
    const targets: TopicRebuildTarget[] = [{ id: "topic-1", doc: topicDoc }];
    const plan = await planTopicRebuild(targets, async (id) => claimDocs.get(id) ?? null);
    expect(plan.topicCount).toBe(1);
    expect(plan.items[0].sourceIds.sort()).toEqual(["note-1", "note-2", "note-3"]);
    expect(plan.totalCalls).toBe(3);
  });

  it("資料が 1 件も見つからないトピックは計画から除かれる", async () => {
    const doc = makeSourceTopicDoc("トピック", "本文", []);
    const plan = await planTopicRebuild([{ id: "topic-1", doc }], async () => null);
    expect(plan).toEqual({ items: [], topicCount: 0, totalCalls: 0 });
  });

  it("topic 以外の kind は無視する", async () => {
    const claimDoc = makeClaimDoc("claim-1", "知見");
    const plan = await planTopicRebuild([{ id: "claim-1", doc: claimDoc }], async () => null);
    expect(plan).toEqual({ items: [], topicCount: 0, totalCalls: 0 });
  });

  it("複数トピックの合計呼び出し回数を積み上げる", async () => {
    const docA = makeSourceTopicDoc("トピックA", "本文", ["note-1"]);
    const docB = makeSourceTopicDoc("トピックB", "本文", ["note-2", "note-3"]);
    const plan = await planTopicRebuild(
      [{ id: "topic-a", doc: docA }, { id: "topic-b", doc: docB }],
      async () => null,
    );
    expect(plan.topicCount).toBe(2);
    expect(plan.totalCalls).toBe(3);
  });

  it("answer（回答ページ）も対象に含める（topicMarkdown から derivedFromNotes をそのまま資料とみなす）", async () => {
    const doc = makeSourceAnswerDoc("問い", "本文", ["note-1", "note-2"]);
    const plan = await planTopicRebuild([{ id: "answer-1", doc }], async () => null);
    expect(plan).toEqual({
      items: [{ topicId: "answer-1", sourceIds: ["note-1", "note-2"] }],
      topicCount: 1,
      totalCalls: 2,
    });
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

describe("applyTopicMerges の groupScope", () => {
  const originalFetch = global.fetch;
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

  function makeDeps(
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
      resolveSource: vi.fn(async (id: string) => ({ title: `資料${id}`, text: "本文" })),
      locale: "ja",
      knowledgeSchema: "schema",
      log: vi.fn(),
      ...overrides,
    };
  }

  function seedOldFormat(): { docs: Map<string, GraphiumDocument>; topics: ExistingTopicForMerge[] } {
    const docs = new Map<string, GraphiumDocument>();
    docs.set("wiki:t1", makeTopicDoc("t1", "焼結条件と粒成長", ["c1"]));
    docs.set("wiki:t2", makeTopicDoc("t2", "SPS 焼結の粒成長抑制", ["c2"]));
    docs.set("wiki:c1", makeClaimDoc("c1", "知見1", ["t1"]));
    docs.set("wiki:c2", makeClaimDoc("c2", "知見2", ["t2"]));
    docs.get("wiki:c1")!.wikiMeta!.derivedFromNotes = ["s1"];
    docs.get("wiki:c2")!.wikiMeta!.derivedFromNotes = ["s2"];
    return {
      docs,
      topics: [
        { id: "t1", title: "焼結条件と粒成長", memberClaimIds: ["c1"] },
        { id: "t2", title: "SPS 焼結の粒成長抑制", memberClaimIds: ["c2"] },
      ],
    };
  }

  function mockReviseOk() {
    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes("/revise-topic")) {
        return { ok: true, json: async () => ({ body: "## 定義\n統合後の本文" }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
  }

  it("groupScope があると、組の保存・ゴミ箱送りは scope の関数が使われ、end が 1 回呼ばれる", async () => {
    const { docs, topics } = seedOldFormat();
    mockReviseOk();
    const deps = makeDeps(docs);
    const scopeSave = vi.fn(async (wikiId: string, doc: GraphiumDocument) => {
      docs.set(`wiki:${wikiId}`, doc);
      return true;
    });
    const scopeDelete = vi.fn(async () => {});
    const end = vi.fn(async () => {});
    const groupScope = vi.fn(async () => ({ handleSaveWikiFile: scopeSave, handleDeleteWikiFile: scopeDelete, end }));

    const result = await mergeTopicsExplicit("t1", ["t2"], topics, { ...deps, groupScope });

    expect(result).toMatchObject({ merged: 1, rebuilt: 1, failed: 0 });
    expect(groupScope).toHaveBeenCalledWith("t1", ["t2"]);
    expect(scopeDelete).toHaveBeenCalledWith("t2");
    // 組み直しの保存（rebuildTopicFromSources 経由）も scope の関数
    expect(scopeSave).toHaveBeenCalledWith("t1", expect.anything(), expect.anything());
    expect(deps.handleSaveWikiFile).not.toHaveBeenCalled();
    expect(deps.handleDeleteWikiFile).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("途中の continue（統合先が話題でない）でも end が 1 回呼ばれる", async () => {
    const { docs, topics } = seedOldFormat();
    docs.delete("wiki:t1");
    const end = vi.fn(async () => {});
    const groupScope = vi.fn(async () => ({
      handleSaveWikiFile: vi.fn(async () => true),
      handleDeleteWikiFile: vi.fn(async () => {}),
      end,
    }));
    const result = await mergeTopicsExplicit("t1", ["t2"], topics, { ...makeDeps(docs), groupScope });
    expect(result.failed).toBe(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  /** 2 組（t1←t2 と t3←t4）のシード */
  function seedTwoGroups() {
    const { docs, topics } = seedOldFormat();
    docs.set("wiki:t3", makeTopicDoc("t3", "拡散と接合", ["c3"]));
    docs.set("wiki:t4", makeTopicDoc("t4", "拡散接合の条件", ["c4"]));
    docs.set("wiki:c3", makeClaimDoc("c3", "知見3", ["t3"]));
    docs.set("wiki:c4", makeClaimDoc("c4", "知見4", ["t4"]));
    docs.get("wiki:c3")!.wikiMeta!.derivedFromNotes = ["s3"];
    docs.get("wiki:c4")!.wikiMeta!.derivedFromNotes = ["s4"];
    topics.push(
      { id: "t3", title: "拡散と接合", memberClaimIds: ["c3"] },
      { id: "t4", title: "拡散接合の条件", memberClaimIds: ["c4"] },
    );
    return { docs, topics, plan: new Map([["t2", "t1"], ["t4", "t3"]]) };
  }

  it("組の処理が例外でも end が呼ばれ、次の組へ進む", async () => {
    const { docs, topics, plan } = seedTwoGroups();
    mockReviseOk();
    const ends: Record<string, ReturnType<typeof vi.fn<() => Promise<void>>>> = { t1: vi.fn(async () => {}), t3: vi.fn(async () => {}) };
    const deletes: Record<string, ReturnType<typeof vi.fn<(wikiId: string) => Promise<void>>>> = { t1: vi.fn(async (_id: string) => {}), t3: vi.fn(async (_id: string) => {}) };
    const groupScope = vi.fn(async (targetId: string) => ({
      // 1 組目（t1）だけ保存が投げる
      handleSaveWikiFile: vi.fn(async (wikiId: string, doc: GraphiumDocument) => {
        if (targetId === "t1") throw new Error("save failed");
        docs.set(`wiki:${wikiId}`, doc);
        return true;
      }),
      handleDeleteWikiFile: deletes[targetId],
      end: ends[targetId],
    }));
    const result = await applyTopicMerges(topics, plan, { ...makeDeps(docs), groupScope });
    expect(groupScope).toHaveBeenCalledTimes(2);
    expect(ends.t1).toHaveBeenCalledTimes(1);
    expect(ends.t3).toHaveBeenCalledTimes(1);
    // 2 組目はゴミ箱送りまで進む
    expect(deletes.t3).toHaveBeenCalledWith("t4");
    expect(result.failed).toBeGreaterThan(0);
  });

  it("groupScope 自体が reject した組は failed になり、保存関数は呼ばれず、次の組へ進む", async () => {
    const { docs, topics, plan } = seedTwoGroups();
    mockReviseOk();
    const deps = makeDeps(docs);
    const end = vi.fn(async () => {});
    const scopeDelete = vi.fn(async () => {});
    const groupScope = vi.fn(async (targetId: string) => {
      if (targetId === "t1") throw new Error("appData write failed");
      return {
        handleSaveWikiFile: vi.fn(async (wikiId: string, doc: GraphiumDocument) => {
          docs.set(`wiki:${wikiId}`, doc);
          return true;
        }),
        handleDeleteWikiFile: scopeDelete,
        end,
      };
    });
    const result = await applyTopicMerges(topics, plan, { ...deps, groupScope });
    expect(result.failed).toBe(1);
    expect(result.merged).toBe(1);
    expect(scopeDelete).toHaveBeenCalledWith("t4");
    expect(end).toHaveBeenCalledTimes(1);
    expect(deps.handleSaveWikiFile).not.toHaveBeenCalled();
    expect(deps.handleDeleteWikiFile).not.toHaveBeenCalled();
  });

  it("end が reject しても握りつぶされ、merged は維持される", async () => {
    const { docs, topics } = seedOldFormat();
    mockReviseOk();
    const end = vi.fn(async () => { throw new Error("end failed"); });
    const groupScope = vi.fn(async () => ({
      handleSaveWikiFile: vi.fn(async (wikiId: string, doc: GraphiumDocument) => {
        docs.set(`wiki:${wikiId}`, doc);
        return true;
      }),
      handleDeleteWikiFile: vi.fn(async () => {}),
      end,
    }));
    const result = await mergeTopicsExplicit("t1", ["t2"], topics, { ...makeDeps(docs), groupScope });
    expect(end).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ merged: 1, failed: 0 });
  });

  it("groupScope が無いときは deps の関数がそのまま使われる", async () => {
    const { docs, topics } = seedOldFormat();
    mockReviseOk();
    const deps = makeDeps(docs);
    const result = await mergeTopicsExplicit("t1", ["t2"], topics, deps);
    expect(result).toMatchObject({ merged: 1, rebuilt: 1, failed: 0 });
    expect(deps.handleDeleteWikiFile).toHaveBeenCalledWith("t2");
    expect(deps.handleSaveWikiFile).toHaveBeenCalled();
  });
});
