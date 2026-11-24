// @vitest-environment jsdom
// 外の AI（MCP）が直接書いたページの読み直し（reloadWikiPagesFromStorage）を確かめる。
// changed / failed / skipped の振り分けと、読む間にアプリが保存したときにキャッシュを踏まないこと

import "./save-path-test-polyfills";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useFileManager } from "./use-file-manager";
import { registerProvider, setActiveProvider } from "../lib/storage/registry";
import { registerLivePeek } from "../lib/peek-save-queue";
import { clearMediaIndexCache } from "../features/asset-browser";
import { clearLatestProcessIndex } from "../features/network-graph/process-index";
import type { StorageProvider } from "../lib/storage/types";
import type { GraphiumDocument, GraphiumFile, WikiMeta } from "../lib/document-types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function wikiDoc(title: string): GraphiumDocument {
  const meta: WikiMeta = {
    kind: "claim",
    derivedFromNotes: ["note-1"],
    derivedFromChats: [],
    generatedAt: "2026-01-01T00:00:00Z",
    generatedBy: { model: "test-model", version: "1.0.0" },
  };
  return {
    version: 2,
    title,
    source: "ai",
    wikiMeta: meta,
    pages: [
      {
        id: "page-1",
        title: "Main",
        blocks: [{ id: "b1", type: "paragraph", content: [{ type: "text", text: `${title} の本文` }] }],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    createdAt: "2026-01-01T00:00:00Z",
    modifiedAt: "2026-01-01T00:00:00Z",
  } as GraphiumDocument;
}

function setupProvider(seed: Record<string, GraphiumDocument>) {
  const wikiFiles = new Map<string, GraphiumDocument>();
  for (const [id, doc] of Object.entries(seed)) wikiFiles.set(id, structuredClone(doc));
  const appData = new Map<string, unknown>();
  const hooks: { beforeLoad?: (id: string) => void } = {};
  const provider = {
    id: "test-mem-mcp-reload",
    displayName: "Test In-Memory (mcp reload)",
    async init() {},
    signIn() {},
    signOut() {},
    getAuthState: () => ({ isSignedIn: true, userEmail: "test@example.com" }),
    onAuthChange: () => () => {},
    async listFiles(): Promise<GraphiumFile[]> { return []; },
    async loadFile(): Promise<never> { throw new Error("not expected"); },
    async createFile(): Promise<string> { return "x"; },
    async saveFile() {},
    async deleteFile() {},
    async listWikiFiles(): Promise<GraphiumFile[]> {
      return Array.from(wikiFiles.entries()).map(([id, doc]) => ({
        id, name: `${doc.title}.graphium.json`, modifiedTime: doc.modifiedAt, createdTime: doc.createdAt,
      }));
    },
    async loadWikiFile(fileId: string): Promise<GraphiumDocument> {
      hooks.beforeLoad?.(fileId);
      const f = wikiFiles.get(fileId);
      if (!f) throw new Error(`wiki file not found: ${fileId}`);
      return structuredClone(f);
    },
    async createWikiFile(): Promise<string> { return "wiki-new"; },
    async saveWikiFile(fileId: string, content: GraphiumDocument): Promise<void> {
      wikiFiles.set(fileId, structuredClone(content));
    },
    async deleteWikiFile(fileId: string): Promise<void> { wikiFiles.delete(fileId); },
    async uploadMedia(): Promise<never> { throw new Error("not expected"); },
    async getMediaBlobUrl(): Promise<never> { throw new Error("not expected"); },
    async readMediaBytes(): Promise<Uint8Array | undefined> { return undefined; },
    extractFileId: () => null,
    getUserEmail: async () => "test@example.com",
    async listMediaFiles() { return []; },
    async authedFetch(): Promise<never> { throw new Error("not expected"); },
    async readAppData(key: string): Promise<unknown | null> {
      return appData.has(key) ? structuredClone(appData.get(key)) : null;
    },
    async writeAppData(key: string, data: unknown): Promise<void> { appData.set(key, structuredClone(data)); },
    clearCache() {},
  } as unknown as StorageProvider;
  registerProvider(provider);
  setActiveProvider("test-mem-mcp-reload");
  return { wikiFiles, hooks };
}

async function renderFileManager(ids: string[]) {
  const hook = renderHook(() => useFileManager(true));
  await waitFor(() => {
    expect(hook.result.current.filesLoading).toBe(false);
    for (const id of ids) expect(hook.result.current.wikiMetas.has(id)).toBe(true);
  });
  return hook;
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  clearMediaIndexCache();
  clearLatestProcessIndex();
});

describe("useFileManager.reloadWikiPagesFromStorage", () => {
  it("変わったページと新しいページだけ changed に入り、一覧・メタ・キャッシュへ反映される", async () => {
    const { wikiFiles } = setupProvider({ w1: wikiDoc("知見A"), w2: wikiDoc("知見B") });
    const { result } = await renderFileManager(["w1", "w2"]);
    const before = result.current.getCachedDoc("wiki:w2");
    wikiFiles.set("w1", wikiDoc("知見A（外で更新）"));
    wikiFiles.set("w3", wikiDoc("知見C（新規）"));
    let r!: Awaited<ReturnType<typeof result.current.reloadWikiPagesFromStorage>>;
    await act(async () => { r = await result.current.reloadWikiPagesFromStorage(["w1", "w2", "w3"]); });
    expect([...r.changed].sort()).toEqual(["w1", "w3"]);
    expect([...r.loaded.keys()].sort()).toEqual(["w1", "w2", "w3"]);
    // 変わっていないページはキャッシュの参照もそのまま
    expect(result.current.getCachedDoc("wiki:w2")).toBe(before);
    expect(result.current.getCachedDoc("wiki:w1")?.title).toBe("知見A（外で更新）");
    expect(result.current.wikiMetas.get("w3")?.title).toBe("知見C（新規）");
    expect(result.current.allWikiFiles.some((f) => f.id === "w3")).toBe(true);
  });

  it("読めなかった id は failed に入り、キャッシュは触らない", async () => {
    setupProvider({ w1: wikiDoc("知見A") });
    const { result } = await renderFileManager(["w1"]);
    let r!: Awaited<ReturnType<typeof result.current.reloadWikiPagesFromStorage>>;
    await act(async () => { r = await result.current.reloadWikiPagesFromStorage(["w1", "nope"]); });
    expect(r.failed).toEqual(["nope"]);
    expect(r.changed.size).toBe(0);
    expect(result.current.getCachedDoc("wiki:nope")).toBeUndefined();
  });

  it("未保存の編集があるページは skipped にして触らない", async () => {
    const { wikiFiles } = setupProvider({ w1: wikiDoc("知見A") });
    const { result } = await renderFileManager(["w1"]);
    const dispose = registerLivePeek("wiki:w1", { hasUnsaved: () => true, flush: () => {} });
    wikiFiles.set("w1", wikiDoc("知見A（外で更新）"));
    let r!: Awaited<ReturnType<typeof result.current.reloadWikiPagesFromStorage>>;
    await act(async () => { r = await result.current.reloadWikiPagesFromStorage(["w1"]); });
    dispose();
    expect(r.skipped).toEqual(["w1"]);
    expect(r.loaded.size).toBe(0);
    expect(result.current.getCachedDoc("wiki:w1")?.title).toBe("知見A");
  });

  it("読む間にアプリが保存を始めたら、読んだ内容では上書きしない（failed で再試行へ）", async () => {
    const { wikiFiles, hooks } = setupProvider({ w1: wikiDoc("知見A") });
    const { result } = await renderFileManager(["w1"]);
    wikiFiles.set("w1", wikiDoc("知見A（外で更新）"));
    // 読み始めたところで、アプリが先に保存した（キャッシュが進む）
    // 1 回だけ（保存で一覧が変わると、ほかの読み込みも同じ口を通る）
    hooks.beforeLoad = () => {
      hooks.beforeLoad = undefined;
      void result.current.handleSaveWikiFile("w1", wikiDoc("知見A（アプリで編集）"));
    };
    let r!: Awaited<ReturnType<typeof result.current.reloadWikiPagesFromStorage>>;
    await act(async () => { r = await result.current.reloadWikiPagesFromStorage(["w1"]); });
    // アプリの保存の最中なので、読んだ内容は使わず（再試行に回す）、アプリの内容が残る
    expect(r.failed).toEqual(["w1"]);
    expect(r.changed.size).toBe(0);
    await waitFor(() => expect(result.current.getCachedDoc("wiki:w1")?.title).toBe("知見A（アプリで編集）"));
  });

  it("読んでいる間にキャッシュの参照が変わったら（保存の最中でなくても）skipped にして上書きしない", async () => {
    const { wikiFiles, hooks } = setupProvider({ w1: wikiDoc("知見A") });
    const { result } = await renderFileManager(["w1"]);
    wikiFiles.set("w1", wikiDoc("知見A（外で更新）"));
    // 保存の途中ではない形で、キャッシュだけが進む（別の経路が書き込み済みの doc を載せた）
    const advanced = wikiDoc("知見A（別経路で更新）");
    hooks.beforeLoad = () => {
      hooks.beforeLoad = undefined;
      result.current.reindexNoteFromDoc("wiki:w1", advanced);
    };
    let r!: Awaited<ReturnType<typeof result.current.reloadWikiPagesFromStorage>>;
    await act(async () => { r = await result.current.reloadWikiPagesFromStorage(["w1"]); });
    expect(r.skipped).toEqual(["w1"]);
    expect(r.changed.size).toBe(0);
    expect(result.current.getCachedDoc("wiki:w1")?.title).toBe("知見A（別経路で更新）");
  });
});
