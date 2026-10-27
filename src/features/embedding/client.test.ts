import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  embeddingModel: "",
  selectedModel: "chat-default",
  embed: vi.fn(),
}));

vi.mock("../../lib/platform", () => ({ isTauri: mocks.isTauri, apiBase: () => "http://api" }));
vi.mock("../settings/store", () => ({
  getEmbeddingModel: () => mocks.embeddingModel,
  getSelectedModel: () => mocks.selectedModel,
  getEmbeddingLLMModel: () => undefined,
}));
vi.mock("./api", () => ({ embed: mocks.embed }));

import { embedTexts, localEmbeddingError } from "./client";

describe("embedTexts", () => {
  beforeEach(() => {
    mocks.isTauri.mockReturnValue(true);
    mocks.embeddingModel = "";
    mocks.embed.mockReset();
    vi.restoreAllMocks();
  });

  it("returns an empty result without calling anything for no texts", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await embedTexts([], "passage");
    expect(r).toEqual({ ok: true, vectors: [], modelVersion: "" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.embed).not.toHaveBeenCalled();
  });

  it("uses the on-device model when the setting says local on desktop", async () => {
    mocks.embeddingModel = "local:bge-m3";
    mocks.embed.mockResolvedValue({ vectors: [[1, 0]], modelVersion: "local:bge-m3-q8" });
    const r = await embedTexts(["a"], "query");
    expect(mocks.embed).toHaveBeenCalledWith("bge-m3", ["a"], "query");
    expect(r).toEqual({ ok: true, vectors: [[1, 0]], modelVersion: "local:bge-m3-q8" });
  });

  it("turns a Rust failure into a coded error", async () => {
    mocks.embeddingModel = "local:bge-m3";
    mocks.embed.mockRejectedValue("EMBEDDING_MODEL_NOT_DOWNLOADED:bge-m3");
    const r = await embedTexts(["a"], "query");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect((r.error as Error & { code?: string }).code).toBe("EMBEDDING_MODEL_NOT_DOWNLOADED");
      expect(r.error.message).toBe("bge-m3");
    }
  });

  it("posts to /wiki/embed with embedding_model when an API model is set", async () => {
    mocks.embeddingModel = "text-embedding-3-small";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ embeddings: [{ vector: [0, 1] }, { vector: [1, 0] }], modelVersion: "text-embedding-3-small" }), { status: 200 }),
    );
    const r = await embedTexts(["a", "b"], "passage");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api/wiki/embed");
    const body = JSON.parse(String(init.body));
    expect(body.embedding_model).toBe("text-embedding-3-small");
    expect(body.texts.map((t: { text: string }) => t.text)).toEqual(["a", "b"]);
    expect(r).toEqual({ ok: true, vectors: [[0, 1], [1, 0]], modelVersion: "text-embedding-3-small" });
  });

  it("sends body.model (the chat default) when nothing is set, and on the web for a local value", async () => {
    mocks.isTauri.mockReturnValue(false);
    mocks.embeddingModel = "local:bge-m3";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ embeddings: [{ vector: [1] }], modelVersion: "m" }), { status: 200 }),
    );
    await embedTexts(["a"], "passage");
    const body = JSON.parse(String((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.embedding_model).toBeUndefined();
    expect(body.model).toBe("chat-default");
    expect(mocks.embed).not.toHaveBeenCalled();
  });

  it("returns the server error with its code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "nope", code: "EMBEDDING_MODEL_UNSUPPORTED" }), { status: 400 }),
    );
    const r = await embedTexts(["a"], "passage");
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r.error as Error & { code?: string }).code).toBe("EMBEDDING_MODEL_UNSUPPORTED");
  });

  it("rejects a response whose vector count does not match", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ embeddings: [{ vector: [1] }] }), { status: 200 }),
    );
    const r = await embedTexts(["a", "b"], "passage");
    expect(r.ok).toBe(false);
  });
});

describe("localEmbeddingError", () => {
  it("splits CODE:detail and keeps plain messages", () => {
    const coded = localEmbeddingError("EMBEDDING_MODEL_NOT_DOWNLOADED:bge-m3") as Error & { code?: string };
    expect(coded.code).toBe("EMBEDDING_MODEL_NOT_DOWNLOADED");
    const plain = localEmbeddingError(new Error("埋め込みに失敗: x")) as Error & { code?: string };
    expect(plain.code).toBeUndefined();
    expect(plain.message).toBe("埋め込みに失敗: x");
  });
});
