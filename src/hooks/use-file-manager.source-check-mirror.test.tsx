// @vitest-environment jsdom
// 出典照合（Source check, v1）— WikiMetaSummary.sourceCheckVerdict ミラーのテスト。
//
// ミラー構築箇所（use-file-manager.ts）は 3 箇所あるが、コード形状は同一
// （groundingValidity ミラーと対で追加されている）なので、代表として
// 起動時読み込み（refreshFiles）と handleSaveWikiFile の 2 経路を実機（renderHook）で検証する。
// 3 つ目（handleCreateWikiFile）は同じ形の書き込みなので、ここでは重複検証を避ける。

import "./save-path-test-polyfills";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useFileManager } from "./use-file-manager";
import { registerProvider, setActiveProvider } from "../lib/storage/registry";
import { clearMediaIndexCache } from "../features/asset-browser";
import { clearLatestProcessIndex } from "../features/network-graph/process-index";
import type { StorageProvider } from "../lib/storage/types";
import type { GraphiumDocument, GraphiumFile, WikiMeta } from "../lib/document-types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function wikiMeta(overrides: Partial<WikiMeta> = {}): WikiMeta {
  return {
    kind: "claim",
    derivedFromNotes: ["note-1"],
    derivedFromChats: [],
    generatedAt: "2026-01-01T00:00:00Z",
    generatedBy: { model: "test-model", version: "1.0.0" },
    ...overrides,
  };
}

function wikiDoc(title: string, meta: WikiMeta): GraphiumDocument {
  return {
    version: 2,
    title,
    wikiMeta: meta,
    pages: [
      {
        id: "page-1",
        title: "Main",
        blocks: [
          { id: "b1", type: "paragraph", content: [{ type: "text", text: `${title} の本文` }] },
        ],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    createdAt: "2026-01-01T00:00:00Z",
    modifiedAt: "2026-01-01T00:00:00Z",
  } as GraphiumDocument;
}

/** ノート CRUD + Wiki CRUD の両方を実装した最小のインメモリ StorageProvider */
function createMockProviderWithWiki(wikiSeed: Record<string, GraphiumDocument> = {}) {
  const files = new Map<string, GraphiumDocument>();
  const wikiFiles = new Map<string, GraphiumDocument>();
  for (const [id, doc] of Object.entries(wikiSeed)) wikiFiles.set(id, structuredClone(doc));
  const appData = new Map<string, unknown>();
  let idCounter = 0;

  const provider = {
    id: "test-mem-wiki",
    displayName: "Test In-Memory (wiki)",
    async init() {},
    signIn() {},
    signOut() {},
    getAuthState: () => ({ isSignedIn: true, userEmail: "test@example.com" }),
    onAuthChange: () => () => {},

    async listFiles(): Promise<GraphiumFile[]> {
      return Array.from(files.entries()).map(([id, doc]) => ({
        id, name: `${doc.title}.graphium.json`,
        modifiedTime: doc.modifiedAt, createdTime: doc.createdAt,
      }));
    },
    async loadFile(fileId: string): Promise<GraphiumDocument> {
      const f = files.get(fileId);
      if (!f) throw new Error(`file not found: ${fileId}`);
      return structuredClone(f);
    },
    async createFile(_title: string, content: GraphiumDocument): Promise<string> {
      const id = `created-${++idCounter}`;
      files.set(id, structuredClone(content));
      return id;
    },
    async saveFile(fileId: string, content: GraphiumDocument): Promise<void> {
      files.set(fileId, structuredClone(content));
    },
    async deleteFile(fileId: string): Promise<void> { files.delete(fileId); },

    async listWikiFiles(): Promise<GraphiumFile[]> {
      return Array.from(wikiFiles.entries()).map(([id, doc]) => ({
        id, name: `${doc.title}.graphium.json`,
        modifiedTime: doc.modifiedAt, createdTime: doc.createdAt,
      }));
    },
    async loadWikiFile(fileId: string): Promise<GraphiumDocument> {
      const f = wikiFiles.get(fileId);
      if (!f) throw new Error(`wiki file not found: ${fileId}`);
      return structuredClone(f);
    },
    async createWikiFile(_title: string, content: GraphiumDocument): Promise<string> {
      const id = `wiki-created-${++idCounter}`;
      wikiFiles.set(id, structuredClone(content));
      return id;
    },
    async saveWikiFile(fileId: string, content: GraphiumDocument): Promise<void> {
      wikiFiles.set(fileId, structuredClone(content));
    },
    async deleteWikiFile(fileId: string): Promise<void> { wikiFiles.delete(fileId); },

    async uploadMedia(file: File) {
      const id = `media-${++idCounter}`;
      return { fileId: id, url: `local-media://${id}`, name: file.name, mimeType: file.type };
    },
    async getMediaBlobUrl(): Promise<never> {
      throw new Error("getMediaBlobUrl is not expected in these tests");
    },
    async readMediaBytes(): Promise<Uint8Array | undefined> { return undefined; },
    extractFileId: () => null,
    getUserEmail: async () => "test@example.com",
    async listMediaFiles() { return []; },
    async authedFetch(): Promise<never> {
      throw new Error("authedFetch should not be called (readAppData/writeAppData are implemented)");
    },
    async readAppData(key: string): Promise<unknown | null> {
      return appData.has(key) ? structuredClone(appData.get(key)) : null;
    },
    async writeAppData(key: string, data: unknown): Promise<void> { appData.set(key, structuredClone(data)); },
    clearCache() {},
  } as unknown as StorageProvider;

  return { provider, files, wikiFiles };
}

function setupProvider(wikiSeed: Record<string, GraphiumDocument> = {}) {
  const mock = createMockProviderWithWiki(wikiSeed);
  registerProvider(mock.provider);
  setActiveProvider("test-mem-wiki");
  return mock;
}

async function renderFileManager() {
  const hook = renderHook(() => useFileManager(true));
  await waitFor(() => {
    expect(hook.result.current.filesLoading).toBe(false);
  });
  return hook;
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  clearMediaIndexCache();
  clearLatestProcessIndex();
});

describe("useFileManager: sourceCheckVerdict ミラー（起動時読み込み）", () => {
  it("wikiMeta.sourceCheck を持つ Wiki を起動時に読み込むと wikiMetas に最小ミラーが立つ", async () => {
    const meta = wikiMeta({
      sourceCheck: {
        verdict: "supported",
        entries: [
          { sourceId: "note-1", sourceKind: "note", verdict: "supported", rationale: "書いてある" },
        ],
        checkedAt: "2026-02-01T00:00:00Z",
        checkedBy: "test-model",
        claimHash: "sha256:abc",
      },
    });
    setupProvider({ "wiki-1": wikiDoc("知見A", meta) });
    const { result } = await renderFileManager();

    await waitFor(() => {
      expect(result.current.wikiMetas.get("wiki-1")?.sourceCheckVerdict).toBeDefined();
    });
    expect(result.current.wikiMetas.get("wiki-1")?.sourceCheckVerdict).toEqual({
      verdict: "supported",
      dismissed: undefined,
      claimHash: "sha256:abc",
    });
  });

  it("wikiMeta.sourceCheck が無い Wiki は sourceCheckVerdict が undefined のまま", async () => {
    setupProvider({ "wiki-2": wikiDoc("知見B", wikiMeta()) });
    const { result } = await renderFileManager();

    await waitFor(() => {
      expect(result.current.wikiMetas.has("wiki-2")).toBe(true);
    });
    expect(result.current.wikiMetas.get("wiki-2")?.sourceCheckVerdict).toBeUndefined();
  });
});

describe("useFileManager: sourceCheckVerdict ミラー（handleSaveWikiFile）", () => {
  it("sourceCheck 付きで保存すると wikiMetas のミラーが更新される", async () => {
    setupProvider({ "wiki-3": wikiDoc("知見C", wikiMeta()) });
    const { result } = await renderFileManager();

    await waitFor(() => {
      expect(result.current.wikiMetas.has("wiki-3")).toBe(true);
    });
    expect(result.current.wikiMetas.get("wiki-3")?.sourceCheckVerdict).toBeUndefined();

    const updated = wikiDoc("知見C", wikiMeta({
      sourceCheck: {
        verdict: "not-in-source",
        entries: [
          { sourceId: "note-1", sourceKind: "note", verdict: "not-in-source", rationale: "書いていない" },
        ],
        checkedAt: "2026-02-02T00:00:00Z",
        checkedBy: "test-model",
        claimHash: "sha256:def",
        dismissed: true,
      },
    }));

    await act(async () => {
      await result.current.handleSaveWikiFile("wiki-3", updated);
    });

    expect(result.current.wikiMetas.get("wiki-3")?.sourceCheckVerdict).toEqual({
      verdict: "not-in-source",
      dismissed: true,
      claimHash: "sha256:def",
    });
  });
});
