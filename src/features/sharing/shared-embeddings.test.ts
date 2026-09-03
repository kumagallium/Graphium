// 共有ナレッジの手元埋め込み（shared-embeddings）のテスト
// - id|hash の印で「未埋め込みのものだけ」埋め込む（同じ hash なら本文も読まない）
// - hash が変われば作り直す
// - 共有から消えた id は embeddingStore から掃除する
// - hash 不一致（verified=false）は埋め込まずに掃除し、hash が変わるまで再試行しない
// - 埋め込みが投げても止まらず、その id は記録しない（次回やり直す）
//
// embedWikiSections（ネットワーク）と embeddingStore（IndexedDB）はモックする。

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SharedEntry, SharedEntryType } from "../../lib/storage/shared";

const embedWikiSections = vi.hoisted(() => vi.fn(async () => {}));
const deleteByDocument = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../wiki/wiki-service", () => ({ embedWikiSections }));
vi.mock("../../lib/embedding-store", () => ({ embeddingStore: { deleteByDocument } }));

import { syncSharedKnowledgeEmbeddings } from "./shared-embeddings";

const EMBEDDED_KEY = "graphium-shared-embedded";

/** localStorage が無い Node 環境用の最小実装 */
function stubLocalStorage(initial: Record<string, string> = {}): Map<string, string> {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  return store;
}

const entry = (id: string, hash: string, type: SharedEntryType = "knowledge"): SharedEntry =>
  ({
    id,
    type,
    author: { name: "Ada", email: "a@b.co" },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    hash,
    prov: { derived_from: [] },
    extra: { title: `K-${id}` },
  }) as SharedEntry;

const docBody = (title: string): Uint8Array =>
  new TextEncoder().encode(JSON.stringify({ title, pages: [{ id: "p1", blocks: [] }] }));

const reader = (verified = true) =>
  vi.fn(async (e: SharedEntry) => ({ body: docBody(e.id), verified }));

beforeEach(() => {
  vi.unstubAllGlobals();
  embedWikiSections.mockClear();
  deleteByDocument.mockClear();
});

describe("syncSharedKnowledgeEmbeddings", () => {
  it("未埋め込みの共有ナレッジだけを埋め込み、id → hash を記録する", async () => {
    const store = stubLocalStorage();
    const read = reader();

    const r = await syncSharedKnowledgeEmbeddings([entry("k1", "h1"), entry("k2", "h2")], read);

    expect(r.embedded.sort()).toEqual(["k1", "k2"]);
    expect(embedWikiSections).toHaveBeenCalledTimes(2);
    expect(embedWikiSections.mock.calls.map((c) => (c as unknown[])[0])).toEqual(["k1", "k2"]);
    expect(JSON.parse(store.get(EMBEDDED_KEY)!)).toEqual({ k1: "h1", k2: "h2" });
  });

  it("hash が同じなら本文も読まない。変わったら作り直す", async () => {
    stubLocalStorage({ [EMBEDDED_KEY]: JSON.stringify({ k1: "h1", k2: "h2" }) });
    const read = reader();

    const r = await syncSharedKnowledgeEmbeddings([entry("k1", "h1"), entry("k2", "h2-new")], read);

    expect(r.embedded).toEqual(["k2"]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(embedWikiSections).toHaveBeenCalledTimes(1);
  });

  it("共有ライブラリから消えた id は埋め込みを消す（スイッチ OFF の空配列も同じ）", async () => {
    const store = stubLocalStorage({ [EMBEDDED_KEY]: JSON.stringify({ k1: "h1", gone: "h9" }) });

    const r = await syncSharedKnowledgeEmbeddings([entry("k1", "h1")], reader());

    expect(r.removed).toEqual(["gone"]);
    expect(deleteByDocument).toHaveBeenCalledWith("gone");
    expect(JSON.parse(store.get(EMBEDDED_KEY)!)).toEqual({ k1: "h1" });

    deleteByDocument.mockClear();
    const off = await syncSharedKnowledgeEmbeddings([], reader());
    expect(off.removed).toEqual(["k1"]);
    expect(embedWikiSections).not.toHaveBeenCalled();
  });

  it("knowledge 以外の共有エントリは対象外", async () => {
    stubLocalStorage();
    const read = reader();

    const r = await syncSharedKnowledgeEmbeddings(
      [entry("n1", "h1", "note"), entry("r1", "h2", "reference")],
      read,
    );

    expect(r.embedded).toEqual([]);
    expect(read).not.toHaveBeenCalled();
    expect(embedWikiSections).not.toHaveBeenCalled();
  });

  it("hash 不一致は埋め込まずに掃除し、その hash では再試行しない", async () => {
    const store = stubLocalStorage();
    const read = reader(false);

    await syncSharedKnowledgeEmbeddings([entry("k1", "h1")], read);
    expect(embedWikiSections).not.toHaveBeenCalled();
    expect(deleteByDocument).toHaveBeenCalledWith("k1");
    expect(JSON.parse(store.get(EMBEDDED_KEY)!)).toEqual({ k1: "h1" });

    // 同じ hash のままなら本文も読まない
    read.mockClear();
    await syncSharedKnowledgeEmbeddings([entry("k1", "h1")], read);
    expect(read).not.toHaveBeenCalled();
  });

  it("埋め込みが投げても止まらず、その id は記録しない（次回やり直す）", async () => {
    const store = stubLocalStorage();
    embedWikiSections.mockImplementationOnce(async () => {
      throw new Error("embed api down");
    });

    const r = await syncSharedKnowledgeEmbeddings([entry("k1", "h1"), entry("k2", "h2")], reader());

    expect(r.failed).toEqual(["k1"]);
    expect(r.embedded).toEqual(["k2"]);
    expect(JSON.parse(store.get(EMBEDDED_KEY)!)).toEqual({ k2: "h2" });
  });
});
