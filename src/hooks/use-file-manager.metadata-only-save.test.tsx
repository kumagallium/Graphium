// @vitest-environment jsdom
// metadataOnly の保存 — 知見の topicIds だけを書くとき、索引の組み直し（全 Wiki の読み直し）を起こさない。
// 知見をまとめて結ぶと「保存回数 × 全ページ」の読み込みになり、実データでブラウザの接続が尽きた。

import "./save-path-test-polyfills";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useFileManager } from "./use-file-manager";
import { registerProvider, setActiveProvider } from "../lib/storage/registry";
import { clearMediaIndexCache } from "../features/asset-browser";
import { clearLatestProcessIndex } from "../features/network-graph/process-index";
import type { StorageProvider } from "../lib/storage/types";
import type { GraphiumDocument, GraphiumFile, WikiMeta } from "../lib/document-types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function claimDoc(title: string, meta: Partial<WikiMeta> = {}): GraphiumDocument {
  return {
    version: 2,
    title,
    wikiMeta: {
      kind: "claim",
      derivedFromNotes: ["note-1"],
      derivedFromChats: [],
      generatedAt: "2026-01-01T00:00:00Z",
      generatedBy: { model: "test-model", version: "1.0.0" },
      ...meta,
    },
    pages: [{ id: "page-1", title: "Main", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
    createdAt: "2026-01-01T00:00:00Z",
    modifiedAt: "2026-01-01T00:00:00Z",
  } as GraphiumDocument;
}

function setupProvider(seed: Record<string, GraphiumDocument>) {
  const wikiFiles = new Map(Object.entries(seed));
  const appData = new Map<string, unknown>();
  const loadWikiFile = vi.fn(async (id: string) => structuredClone(wikiFiles.get(id)!));
  const provider = {
    id: "test-metadata-only",
    displayName: "Test",
    async init() {},
    signIn() {},
    signOut() {},
    getAuthState: () => ({ isSignedIn: true, userEmail: "test@example.com" }),
    onAuthChange: () => () => {},
    listFiles: async (): Promise<GraphiumFile[]> => [],
    listWikiFiles: async (): Promise<GraphiumFile[]> =>
      [...wikiFiles].map(([id, doc]) => ({
        id,
        name: `${doc.title}.graphium.json`,
        modifiedTime: doc.modifiedAt,
        createdTime: doc.createdAt,
      })),
    loadWikiFile,
    saveWikiFile: async (id: string, doc: GraphiumDocument) => { wikiFiles.set(id, structuredClone(doc)); },
    extractFileId: () => null,
    getUserEmail: async () => "test@example.com",
    listMediaFiles: async () => [],
    readAppData: async (key: string) => appData.get(key) ?? null,
    writeAppData: async (key: string, data: unknown) => { appData.set(key, data); },
    clearCache() {},
  } as unknown as StorageProvider;
  registerProvider(provider);
  setActiveProvider("test-metadata-only");
  return { wikiFiles, loadWikiFile };
}

beforeEach(() => {
  localStorage.clear();
  clearMediaIndexCache();
  clearLatestProcessIndex();
});

describe("handleSaveWikiFile の metadataOnly", () => {
  async function ready() {
    const mock = setupProvider({ c1: claimDoc("知見 1"), c2: claimDoc("知見 2") });
    const hook = renderHook(() => useFileManager(true));
    await waitFor(() => expect(hook.result.current.wikiMetas.size).toBe(2));
    await waitFor(() => expect(hook.result.current.noteIndex?.notes.length).toBe(2));
    return { ...mock, ...hook };
  }

  it("書いて一覧の写しも更新するが、全 Wiki を読み直さない", async () => {
    const { result, wikiFiles, loadWikiFile } = await ready();
    loadWikiFile.mockClear();

    await act(async () => {
      await result.current.handleSaveWikiFile("c1", claimDoc("知見 1", { topicIds: ["t1"] }), { metadataOnly: true });
    });
    // 組み直しが走るなら、ここまでに読み直しが始まっている
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

    expect(wikiFiles.get("c1")?.wikiMeta?.topicIds).toEqual(["t1"]);
    expect(result.current.wikiMetas.get("c1")?.topicIds).toEqual(["t1"]);
    expect(result.current.getCachedDoc("wiki:c1")?.wikiMeta?.topicIds).toEqual(["t1"]);
    expect(loadWikiFile).not.toHaveBeenCalled();
  });

  it("指定しない保存は、これまでどおり索引を組み直す", async () => {
    const { result, loadWikiFile } = await ready();
    loadWikiFile.mockClear();

    await act(async () => {
      await result.current.handleSaveWikiFile("c1", claimDoc("知見 1（改）"));
    });
    await waitFor(() => expect(loadWikiFile).toHaveBeenCalled());
  });
});
