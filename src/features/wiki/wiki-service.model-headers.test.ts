// @vitest-environment jsdom
//
// Web 版で、モデル名を渡す関数のヘッダー（X-LLM-API-Key）と body.model が同じモデルを
// 指すことを確かめる（model-resolve）。
//
// resolveModelConfig（server）はヘッダーを最優先するため、ヘッダーと body.model が
// 別モデルを指すと、呼び出し元が意図したモデル（例: チャットモデル）ではなく、ヘッダーの
// モデルが黙って実行される。mergeTopicBodies / rewriteAnswerFromConversation /
// routeTopicsForSource / reviseTopicFromSource / surveySourceForWindows /
// consolidateTopics は、いずれも呼び出し元から明示的なモデル名を受け取れるため、
// このずれが起きないことを確かめる。
//
// jsdom 環境（window はあるが __TAURI__ 系プロパティが無い）は isTauri() が
// 自然に false を返す = Web 版として動く。localStorage も jsdom のものを使う。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mergeTopicBodies,
  rewriteAnswerFromConversation,
  routeTopicsForSource,
  reviseTopicFromSource,
  surveySourceForWindows,
  consolidateTopics,
  embedWikiSections,
} from "./wiki-service";
import type { GraphiumDocument } from "../../lib/document-types";

const LLM_MODELS_KEY = "graphium-llm-models";

// embedWikiSections は embeddingStore（IndexedDB 経由）を呼ぶ。ここでは body の
// 組み立てだけを見るので、ストア自体はスタブして IndexedDB 依存を避ける。
vi.mock("../../lib/embedding-store", () => ({
  embeddingStore: {
    deleteByDocument: vi.fn(async () => {}),
    setEmbedding: vi.fn(async () => {}),
  },
}));

function setModels(models: unknown[]): void {
  localStorage.setItem(LLM_MODELS_KEY, JSON.stringify(models));
}

function setSettings(settings: Record<string, unknown>): void {
  localStorage.setItem("graphium-settings", JSON.stringify(settings));
}

type FetchCall = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

function fetchCalls(): FetchCall[] {
  return (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([url, init]) => ({
    url: String(url),
    headers: ((init as RequestInit | undefined)?.headers ?? {}) as Record<string, string>,
    body: JSON.parse(String((init as RequestInit | undefined)?.body ?? "{}")),
  }));
}

function headerModel(call: FetchCall): { modelId: string; apiKey: string } | undefined {
  const raw = call.headers["X-LLM-API-Key"];
  if (!raw) return undefined;
  const parsed = JSON.parse(raw) as { modelId: string; apiKey: string };
  return { modelId: parsed.modelId, apiKey: parsed.apiKey };
}

function mockOk(json: unknown) {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => json })) as unknown as typeof fetch;
}

const originalFetch = global.fetch;

beforeEach(() => {
  localStorage.clear();
  setModels([
    { id: "m-default", name: "Default M", provider: "openai-compatible", modelId: "default-id", apiKey: "key-default", apiBase: null },
    { id: "m-chat", name: "Chat M", provider: "openai-compatible", modelId: "chat-id", apiKey: "key-chat", apiBase: null },
  ]);
  setSettings({ model: "Default M", chatSynthesisModel: "Chat M" });
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("名前を渡したとき、Web 版のヘッダーはその名前で引いたモデルになる", () => {
  it("mergeTopicBodies: Chat M を渡すとヘッダー・body ともに Chat M", async () => {
    mockOk({ body: "merged" });
    await mergeTopicBodies("title", ["a", "b"], "ja", "Chat M");
    const [call] = fetchCalls();
    expect(call.body.model).toBe("Chat M");
    expect(headerModel(call)).toEqual({ modelId: "chat-id", apiKey: "key-chat" });
  });

  it("rewriteAnswerFromConversation: Chat M を渡すとヘッダー・body ともに Chat M", async () => {
    mockOk({ title: "t", body: "answer [#1]" });
    await rewriteAnswerFromConversation("question [#1]", "answer [#1]", [], [], "ja", "Chat M");
    const [call] = fetchCalls();
    expect(call.body.model).toBe("Chat M");
    expect(headerModel(call)).toEqual({ modelId: "chat-id", apiKey: "key-chat" });
  });

  it("routeTopicsForSource: Chat M を渡すとヘッダー・body ともに Chat M", async () => {
    mockOk({ update: [], create: [] });
    await routeTopicsForSource({ id: "s1", title: "t", text: "text" }, [], "ja", "Chat M");
    const [call] = fetchCalls();
    expect(call.body.model).toBe("Chat M");
    expect(headerModel(call)).toEqual({ modelId: "chat-id", apiKey: "key-chat" });
  });

  it("reviseTopicFromSource: Chat M を渡すとヘッダー・body ともに Chat M", async () => {
    mockOk({ body: "revised" });
    await reviseTopicFromSource("title", "", { id: "s1", title: "t", text: "text" }, "ja", "Chat M");
    const [call] = fetchCalls();
    expect(call.body.model).toBe("Chat M");
    expect(headerModel(call)).toEqual({ modelId: "chat-id", apiKey: "key-chat" });
  });

  it("surveySourceForWindows: Chat M を渡すとヘッダー・body ともに Chat M", async () => {
    mockOk({ survey: "survey" });
    await surveySourceForWindows({ title: "t", text: "text" }, "ja", "Chat M");
    const [call] = fetchCalls();
    expect(call.body.model).toBe("Chat M");
    expect(headerModel(call)).toEqual({ modelId: "chat-id", apiKey: "key-chat" });
  });

  it("consolidateTopics: Default M を渡すとヘッダー・body ともに Default M（既定は chatSynthesis だが明示した名前が勝つ）", async () => {
    mockOk({ mapping: {} });
    await consolidateTopics(["a"], [], "ja", "Default M");
    const [call] = fetchCalls();
    expect(call.body.model).toBe("Default M");
    expect(headerModel(call)).toEqual({ modelId: "default-id", apiKey: "key-default" });
  });
});

describe("見つからない名前を渡したとき、ヘッダーは無く、body には見つからない名前のまま（別モデルへ回さない）", () => {
  it("mergeTopicBodies: 見つからない名前 → ヘッダー無し・body.model はそのまま残る", async () => {
    mockOk({ body: "merged" });
    await mergeTopicBodies("title", ["a", "b"], "ja", "Deleted model");
    const [call] = fetchCalls();
    expect(call.body.model).toBe("Deleted model");
    expect(call.headers["X-LLM-API-Key"]).toBeUndefined();
  });

  it("routeTopicsForSource: 見つからない名前 → ヘッダー無し・body.model はそのまま残る", async () => {
    mockOk({ update: [], create: [] });
    await routeTopicsForSource({ id: "s1", title: "t", text: "text" }, [], "ja", "Deleted model");
    const [call] = fetchCalls();
    expect(call.body.model).toBe("Deleted model");
    expect(call.headers["X-LLM-API-Key"]).toBeUndefined();
  });
});

describe("名前を渡さないとき、今までどおり mode 既定でヘッダー・body が揃う", () => {
  it("mergeTopicBodies: 渡さない → default（Default M）でヘッダー・body が揃う", async () => {
    mockOk({ body: "merged" });
    await mergeTopicBodies("title", ["a", "b"], "ja");
    const [call] = fetchCalls();
    expect(call.body.model).toBe("Default M");
    expect(headerModel(call)).toEqual({ modelId: "default-id", apiKey: "key-default" });
  });

  it("consolidateTopics: 渡さない → chatSynthesis（Chat M）でヘッダー・body が揃う", async () => {
    mockOk({ mapping: {} });
    await consolidateTopics(["a"], [], "ja");
    const [call] = fetchCalls();
    expect(call.body.model).toBe("Chat M");
    expect(headerModel(call)).toEqual({ modelId: "chat-id", apiKey: "key-chat" });
  });
});

describe("Embedding のモデルが未設定のとき、body.model に既定モデルの表示名を載せる", () => {
  function wikiDoc(): GraphiumDocument {
    return {
      version: 2,
      title: "焼結の知見",
      pages: [{ id: "p1", title: "Main", blocks: [
        { id: "lead", type: "paragraph", content: [{ type: "text", text: "本文", styles: {} }] },
      ], labels: {}, provLinks: [], knowledgeLinks: [] }],
      wikiMeta: {
        kind: "claim",
        derivedFromNotes: [],
        derivedFromChats: [],
        generatedAt: "2026-01-01T00:00:00Z",
        generatedBy: { model: "m", version: "1.0.0" },
      },
      createdAt: "2026-01-01T00:00:00Z",
      modifiedAt: "2026-01-01T00:00:00Z",
    } as unknown as GraphiumDocument;
  }

  it("embeddingModel 未設定・default はある → body.model に default の表示名を載せる（embedding_model は送らない）", async () => {
    // embeddingModel は未設定（デフォルト空文字）、settings.model は beforeEach で "Default M"
    mockOk({ embeddings: [], modelVersion: "v1" });
    await embedWikiSections("w1", wikiDoc());
    const [call] = fetchCalls();
    expect(call.body.embedding_model).toBeUndefined();
    expect(call.body.model).toBe("Default M");
  });

  it("embeddingModel も default も未設定なら、今までどおり何も載せない", async () => {
    setSettings({ model: "", embeddingModel: "" });
    mockOk({ embeddings: [], modelVersion: "v1" });
    await embedWikiSections("w1", wikiDoc());
    const [call] = fetchCalls();
    expect(call.body.embedding_model).toBeUndefined();
    expect(call.body.model).toBeUndefined();
  });

  it("embeddingModel が設定済みなら、それを embedding_model に載せる（従来どおり）", async () => {
    setSettings({ model: "Default M", embeddingModel: "Default M" });
    mockOk({ embeddings: [], modelVersion: "v1" });
    await embedWikiSections("w1", wikiDoc());
    const [call] = fetchCalls();
    expect(call.body.embedding_model).toBe("Default M");
    expect(call.body.model).toBeUndefined();
  });
});
