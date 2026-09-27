// 表示名とモデル ID が違うモデルでも、トピック段・知見の書き直し・洞察の重複判定が
// 取り込みと同じモデルで走ることを確かめる。
// デスクトップ版（Tauri）は X-LLM-API-Key ヘッダーを付けず、body.model（モデルの表示名）だけで
// サーバーにモデルを伝える。サーバーの resolveModelConfig は表示名で登録モデルを引くので、
// クライアントが送った body.model を実際に resolveModelConfig へ通して、どの登録モデルに
// 解決されるかまで見る（以前は取り込みが返したモデル ID を送り、「モデル未登録」で断られていた）。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GraphiumDocument, WikiMeta } from "../../lib/document-types";
import type { IngesterOutput } from "../../server/services/wiki-ingester";

const h = vi.hoisted(() => {
  const now = new Date().toISOString();
  const registered = [
    // 先頭 = サーバーの既定（models.json の先頭）。ユーザーが選んだモデルではない
    { id: "m-first", name: "First (unused)", provider: "openai-compatible", modelId: "first-model", apiKey: "k", apiBase: null, createdAt: now },
    // 設定で既定モデルに選んだモデル。表示名とモデル ID が違う
    { id: "m-verify", name: "Mock (verify)", provider: "openai-compatible", modelId: "mock-model", apiKey: "k", apiBase: null, createdAt: now },
    { id: "m-insight", name: "Insight (verify)", provider: "openai-compatible", modelId: "insight-model", apiKey: "k", apiBase: null, createdAt: now },
  ];
  return { registered, selectedModel: "Mock (verify)", insightModel: "Insight (verify)" };
});

vi.mock("../../lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/platform")>()),
  // デスクトップ版: ヘッダーを付けず body.model だけでモデルを伝える経路
  isTauri: () => true,
}));

vi.mock("../settings/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/store")>()),
  getSelectedModel: () => h.selectedModel,
  getInsightModelName: () => h.insightModel,
}));

vi.mock("../../server/config/models.js", () => ({
  listModels: () => h.registered,
  getDefaultModel: () => h.registered[0],
  getServerMode: () => "node",
}));

import { runSourceTopicStage, rebuildTopicFromSources, type SourceTopicStageDeps } from "./topic-stage";
import { rewriteAndMerge, resolveAtomDuplicates, surveySourceForWindows } from "./wiki-service";
import { resolveModelConfig } from "../../server/services/header-model";

type FetchCall = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

function fetchCalls(): FetchCall[] {
  return (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([url, init]) => ({
    url: String(url),
    headers: ((init as RequestInit | undefined)?.headers ?? {}) as Record<string, string>,
    body: JSON.parse(String((init as RequestInit | undefined)?.body ?? "{}")),
  }));
}

/** クライアントが送った要求を、サーバーの resolveModelConfig がどの登録モデルに解決するか */
function resolvedModelId(call: FetchCall): string | undefined {
  const ctx = { req: { header: (k: string) => call.headers[k] } } as never;
  const model = typeof call.body.model === "string" ? call.body.model : undefined;
  return resolveModelConfig(ctx, { modelName: model })?.id;
}

function mockTopicApis() {
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (url.includes("/route-topics")) {
      const existing = (body.existingTopics as { id: string }[]) ?? [];
      return { ok: true, json: async () => ({ update: existing.map((t) => t.id), create: existing.length === 0 ? ["焼き色"] : [] }) };
    }
    if (url.includes("/revise-topic")) {
      return { ok: true, json: async () => ({ body: `## 定義\n本文[[source:${body.source.id}]]` }) };
    }
    if (url.includes("/survey-source")) {
      return { ok: true, json: async () => ({ survey: "見取り図" }) };
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
}

function makeDeps(overrides: Partial<SourceTopicStageDeps> = {}) {
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

function makeWikiDoc(title: string, meta: Partial<WikiMeta>, blocks: unknown[] = []): GraphiumDocument {
  return {
    version: 2,
    title,
    pages: [{ id: "main", title, blocks: blocks as never, labels: {}, provLinks: [], knowledgeLinks: [] }],
    source: "ai",
    wikiMeta: {
      kind: "topic",
      derivedFromNotes: [],
      derivedFromChats: [],
      generatedAt: new Date().toISOString(),
      generatedBy: { model: "old-model", version: "1.0.0" },
      ...meta,
    } as WikiMeta,
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  };
}

const originalFetch = global.fetch;

beforeEach(() => {
  mockTopicApis();
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("トピック段は取り込みと同じモデルで走る（表示名 ≠ モデル ID）", () => {
  it("取り込みが返したモデル ID は記録にだけ使い、振り分け・改訂は設定の表示名で頼む", async () => {
    const { deps } = makeDeps();
    const result = await runSourceTopicStage(
      [{ id: "note-1", title: "焼成温度の検討", text: "200℃ で焼くと色づく。", generatedByModel: "mock-model" }],
      deps,
    );

    expect(result).toMatchObject({ created: 1, failed: 0 });
    const calls = fetchCalls();
    expect(calls.map((c) => c.url.split("/").pop())).toEqual(["route-topics", "revise-topic"]);
    for (const call of calls) {
      expect(call.headers["X-LLM-API-Key"]).toBeUndefined();
      expect(call.body.model).toBe("Mock (verify)");
      // サーバーは取り込みと同じ登録モデルに解決する（モデル ID のままだと undefined = モデル未登録）
      expect(resolvedModelId(call)).toBe("m-verify");
    }
    const [createdDoc] = (deps.handleCreateWikiFile as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createdDoc.wikiMeta.generatedBy.model).toBe("mock-model");
  });

  it("知見 OFF（取り込みがモデルを返さない）でも、先頭のモデルではなく設定の既定モデルで走る", async () => {
    const { deps } = makeDeps();
    const result = await runSourceTopicStage([{ id: "note-1", title: "焼成温度の検討", text: "200℃ で焼くと色づく。" }], deps);

    expect(result).toMatchObject({ created: 1, failed: 0 });
    for (const call of fetchCalls()) {
      expect(call.body.model).toBe("Mock (verify)");
      expect(resolvedModelId(call)).toBe("m-verify");
    }
  });

  it("長い資料（窓が複数）も、見取り図・振り分け・改訂のすべてが設定の表示名で頼む", async () => {
    const { deps } = makeDeps({
      surveySource: (source, language, model, signal) => surveySourceForWindows(source, language, model, signal),
    });
    const longText = Array.from({ length: 12 }, (_, i) => `段落${i}。${"焼成の記録。".repeat(80)}`).join("\n\n");
    const result = await runSourceTopicStage(
      [{ id: "note-1", title: "長い記録", text: longText, generatedByModel: "mock-model" }],
      deps,
    );

    expect(result.failed).toBe(0);
    const calls = fetchCalls();
    const kinds = new Set(calls.map((c) => c.url.split("/").pop()));
    expect(kinds).toEqual(new Set(["survey-source", "route-topics", "revise-topic"]));
    for (const call of calls) {
      expect(call.body.model).toBe("Mock (verify)");
      expect(resolvedModelId(call)).toBe("m-verify");
    }
  });

  it("旧形式トピックの移行（資料から組み直し）も設定の表示名で頼み、記録にはモデル ID を残す", async () => {
    const { deps, docs } = makeDeps({
      existingTopicRefs: [{ id: "topic-1", title: "旧トピック" }],
      resolveSource: vi.fn(async (id: string) => (id === "old-note" ? { title: "旧資料", text: "旧資料の本文" } : undefined)),
    });
    docs.set("wiki:topic-1", makeWikiDoc("旧トピック", { derivedFromClaims: ["claim-1"] }));
    docs.set("wiki:claim-1", makeWikiDoc("知見1", { kind: "claim", derivedFromNotes: ["old-note"] }));

    const result = await runSourceTopicStage(
      [{ id: "note-1", title: "新資料", text: "新資料の本文", generatedByModel: "mock-model" }],
      deps,
    );

    expect(result).toMatchObject({ migrated: 1, failed: 0 });
    for (const call of fetchCalls()) {
      expect(call.body.model).toBe("Mock (verify)");
      expect(resolvedModelId(call)).toBe("m-verify");
    }
    expect(docs.get("wiki:topic-1")?.wikiMeta?.generatedBy.model).toBe("mock-model");
  });

  it("deps.model を渡せば、そのモデルで頼む（記録用のモデル名が無ければそれを記録する）", async () => {
    const { deps } = makeDeps({ model: "Insight (verify)" });
    await runSourceTopicStage([{ id: "note-1", title: "焼成温度の検討", text: "200℃ で焼くと色づく。" }], deps);

    for (const call of fetchCalls()) {
      expect(call.body.model).toBe("Insight (verify)");
      expect(resolvedModelId(call)).toBe("m-insight");
    }
    const [createdDoc] = (deps.handleCreateWikiFile as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createdDoc.wikiMeta.generatedBy.model).toBe("Insight (verify)");
  });
});

describe("rebuildTopicFromSources（手動の作り直し）", () => {
  function rebuildDeps(model?: string) {
    const docs = new Map<string, GraphiumDocument>();
    docs.set("wiki:topic-1", makeWikiDoc("トピック", { topicMarkdown: "## 定義\n旧本文", derivedFromNotes: ["note-1"] }));
    return {
      docs,
      deps: {
        loadDoc: vi.fn(async (id: string) => docs.get(id) ?? null),
        getCachedDoc: vi.fn((id: string) => docs.get(id) ?? null),
        handleSaveWikiFile: vi.fn(async (wikiId: string, doc: GraphiumDocument) => {
          docs.set(`wiki:${wikiId}`, doc);
          return true;
        }),
        resolveSource: vi.fn(async () => ({ title: "資料", text: "資料の本文" })),
        locale: "ja",
        knowledgeSchema: "schema",
        ...(model ? { model } : {}),
      },
    };
  }

  it("選んだモデルを渡せばそのモデルで頼み、そのモデル名を記録する（従来どおり）", async () => {
    const { deps, docs } = rebuildDeps("Insight (verify)");
    const result = await rebuildTopicFromSources("topic-1", ["note-1"], deps);

    expect(result.rebuilt).toBe(true);
    const [call] = fetchCalls();
    expect(call.body.model).toBe("Insight (verify)");
    expect(docs.get("wiki:topic-1")?.wikiMeta?.generatedBy.model).toBe("Insight (verify)");
  });

  it("モデルを渡さなければ、先頭のモデルではなく設定の既定モデルで頼む", async () => {
    const { deps } = rebuildDeps();
    await rebuildTopicFromSources("topic-1", ["note-1"], deps);

    const [call] = fetchCalls();
    expect(call.body.model).toBe("Mock (verify)");
    expect(resolvedModelId(call)).toBe("m-verify");
  });
});

describe("同じ原因の他の経路", () => {
  it("知見のマージ書き直し（rewriteAndMerge）は設定の表示名で頼み、記録には渡されたモデル ID を残す", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ sections: [{ heading: "節1", content: "書き直した内容。" }] }),
    })) as unknown as typeof fetch;
    const existing = makeWikiDoc("知見", { kind: "claim", derivedFromNotes: ["note-1"] }, [
      { id: "h1", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "節1", styles: {} }], children: [] },
    ]);
    const ingesterOutput: IngesterOutput = {
      kind: "claim",
      title: "知見",
      sections: [{ heading: "節1", content: "新しい内容。" }],
      suggestedAction: "merge",
      confidence: 0.9,
      relatedClaims: [],
      externalReferences: [],
    };

    const next = await rewriteAndMerge(existing, ingesterOutput, "note-2", "mock-model");

    const [call] = fetchCalls();
    expect(call.url).toContain("/rewrite");
    expect(call.body.model).toBe("Mock (verify)");
    expect(resolvedModelId(call)).toBe("m-verify");
    expect(next.wikiMeta?.generatedBy.model).toBe("mock-model");
  });

  it("洞察の重複判定は、モデルを渡さなければ設定の洞察モデル（表示名）で頼む", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ verdicts: [{ index: 1, verdict: "same" }] }),
    })) as unknown as typeof fetch;

    const result = await resolveAtomDuplicates(
      [{ candidate: { title: "候補", body: "本文" }, matchedDocId: "atom-1", score: 0.95 }],
      async () => ({ title: "既存の洞察", body: "本文" }),
      "ja",
    );

    expect(result.same).toHaveLength(1);
    const [call] = fetchCalls();
    expect(call.url).toContain("/judge-atom-duplicates");
    expect(call.body.model).toBe("Insight (verify)");
    expect(resolvedModelId(call)).toBe("m-insight");
  });
});
