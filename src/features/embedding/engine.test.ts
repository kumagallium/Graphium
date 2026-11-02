import { describe, it, expect } from "vitest";
import {
  LOCAL_EMBEDDING_MODELS,
  localEmbeddingValue,
  parseLocalEmbeddingValue,
  resolveEmbeddingEngine,
} from "./engine";

describe("resolveEmbeddingEngine", () => {
  it("keeps the API behaviour for empty and API model names", () => {
    expect(resolveEmbeddingEngine("", true)).toEqual({ kind: "api", embeddingModel: "" });
    expect(resolveEmbeddingEngine("text-embedding-3-small", true)).toEqual({ kind: "api", embeddingModel: "text-embedding-3-small" });
  });

  it("uses the on-device model on desktop", () => {
    expect(resolveEmbeddingEngine("local:bge-m3", true)).toEqual({ kind: "local", name: "bge-m3", implicit: false });
    expect(resolveEmbeddingEngine(localEmbeddingValue("multilingual-e5-small"), true)).toEqual({ kind: "local", name: "multilingual-e5-small", implicit: false });
  });

  it("falls back to the API default on the web or for unknown local names", () => {
    expect(resolveEmbeddingEngine("local:bge-m3", false)).toEqual({ kind: "api", embeddingModel: "" });
    expect(resolveEmbeddingEngine("local:nope", true)).toEqual({ kind: "api", embeddingModel: "" });
  });

  it("defaults to the on-device model on desktop when nothing is set and no API vectors exist", () => {
    expect(resolveEmbeddingEngine("", { desktop: true, localByDefault: true })).toEqual({ kind: "local", name: "bge-m3", implicit: true });
    // これまで API で埋め込んできた人は従来どおり
    expect(resolveEmbeddingEngine("", { desktop: true, localByDefault: false })).toEqual({ kind: "api", embeddingModel: "" });
    // Web 版は端末内を持たない
    expect(resolveEmbeddingEngine("", { desktop: false, localByDefault: true })).toEqual({ kind: "api", embeddingModel: "" });
    // 明示の API モデル名は既定に負けない
    expect(resolveEmbeddingEngine("text-embedding-3-small", { desktop: true, localByDefault: true })).toEqual({ kind: "api", embeddingModel: "text-embedding-3-small" });
  });

  it("parses only known names", () => {
    expect(parseLocalEmbeddingValue("local:bge-m3")).toBe("bge-m3");
    expect(parseLocalEmbeddingValue("local:other")).toBeNull();
    expect(parseLocalEmbeddingValue("bge-m3")).toBeNull();
  });

  it("lists the recommended model first with distinct versions", () => {
    expect(LOCAL_EMBEDDING_MODELS[0].recommended).toBe(true);
    expect(new Set(LOCAL_EMBEDDING_MODELS.map((m) => m.version)).size).toBe(LOCAL_EMBEDDING_MODELS.length);
    for (const m of LOCAL_EMBEDDING_MODELS) expect(m.version).toBe(`local:${m.name}-q8`);
  });
});
