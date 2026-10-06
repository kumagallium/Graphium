// @vitest-environment jsdom
// 保守の操作の取り消しが使う Wiki 用の 3 関数（loadWikiDocFresh / getWikiIndexFlags /
// restoreWikiIndexFlag）と、handleRestore の Wiki 経路を確かめる。

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

function setupProvider(wikiSeed: Record<string, GraphiumDocument>) {
  const wikiFiles = new Map<string, GraphiumDocument>();
  for (const [id, doc] of Object.entries(wikiSeed)) wikiFiles.set(id, structuredClone(doc));
  const appData = new Map<string, unknown>();
  const loadWikiFile = vi.fn(async (fileId: string): Promise<GraphiumDocument> => {
    const f = wikiFiles.get(fileId);
    if (!f) throw new Error(`wiki file not found: ${fileId}`);
    return structuredClone(f);
  });
  const provider = {
    id: "test-mem-wiki-restore",
    displayName: "Test In-Memory (wiki restore)",
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
    loadWikiFile,
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
  setActiveProvider("test-mem-wiki-restore");
  return { wikiFiles, loadWikiFile, appData };
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

describe("useFileManager: Wiki の取り消し用ヘルパー", () => {
  it("loadWikiDocFresh: ストレージの最新を読み、キャッシュにあれば上書きしない", async () => {
    const { wikiFiles } = setupProvider({ "w1": wikiDoc("知見A") });
    const { result } = await renderFileManager(["w1"]);

    // 起動時にキャッシュへ載っている版（知見A）。ストレージだけ書き換わった状況を作る
    wikiFiles.set("w1", wikiDoc("知見A（外で更新）"));
    let fresh: GraphiumDocument | null = null;
    await act(async () => { fresh = await result.current.loadWikiDocFresh("w1"); });
    expect(fresh!.title).toBe("知見A（外で更新）");
    // キャッシュは上書きされない
    expect(result.current.getCachedDoc("wiki:w1")?.title).toBe("知見A");
  });

  it("loadWikiDocFresh: 読めなければキャッシュ、どちらも無ければ null", async () => {
    const { wikiFiles } = setupProvider({ "w1": wikiDoc("知見A") });
    const { result } = await renderFileManager(["w1"]);
    wikiFiles.delete("w1");
    let cached: GraphiumDocument | null = null;
    await act(async () => { cached = await result.current.loadWikiDocFresh("w1"); });
    expect(cached!.title).toBe("知見A");
    let none: GraphiumDocument | null | undefined;
    await act(async () => { none = await result.current.loadWikiDocFresh("nope"); });
    expect(none).toBeNull();
  });

  it("getWikiIndexFlags / restoreWikiIndexFlag: アーカイブ・ゴミ箱のフラグだけを戻し、一覧に復帰する", async () => {
    setupProvider({ "w1": wikiDoc("知見A"), "w2": wikiDoc("知見B") });
    const { result } = await renderFileManager(["w1", "w2"]);
    await waitFor(() => expect(result.current.getWikiIndexFlags("w1")).not.toBeNull());

    expect(result.current.getWikiIndexFlags("w1")).toEqual({ deletedAt: null, archivedAt: null });
    expect(result.current.getWikiIndexFlags("nope")).toBeNull();

    await act(async () => { await result.current.handleArchiveWikiFile("w1"); });
    await act(async () => { await result.current.handleDeleteWikiFile("w2"); });
    expect(result.current.getWikiIndexFlags("w1")?.archivedAt).toBeTruthy();
    expect(result.current.getWikiIndexFlags("w2")?.deletedAt).toBeTruthy();
    expect(result.current.wikiFiles.map((f) => f.id)).toEqual([]);

    const allBefore = result.current.allWikiFiles;
    await act(async () => { await result.current.restoreWikiIndexFlag("w1", "archivedAt"); });
    await act(async () => { await result.current.restoreWikiIndexFlag("w2", "deletedAt"); });

    expect(result.current.getWikiIndexFlags("w1")).toEqual({ deletedAt: null, archivedAt: null });
    expect(result.current.getWikiIndexFlags("w2")).toEqual({ deletedAt: null, archivedAt: null });
    // 一覧は return 側のフィルタで戻る。wikiFiles state（allWikiFiles）は触っていない
    expect(result.current.wikiFiles.map((f) => f.id).sort()).toEqual(["w1", "w2"]);
    expect(result.current.allWikiFiles).toBe(allBefore);
  });

  it("restoreWikiIndexFlag: 戻したフラグが索引ファイル（appData の note-index）へ書き出される", async () => {
    const { appData } = setupProvider({ "w1": wikiDoc("知見A") });
    const { result } = await renderFileManager(["w1"]);
    await waitFor(() => expect(result.current.getWikiIndexFlags("w1")).not.toBeNull());
    await act(async () => { await result.current.handleDeleteWikiFile("w1"); });
    await act(async () => { await result.current.restoreWikiIndexFlag("w1", "deletedAt"); });
    const saved = appData.get("note-index") as { notes: { noteId: string; deletedAt?: string }[] };
    const entry = saved.notes.find((n) => n.noteId === "w1");
    expect(entry).toBeDefined();
    expect(entry!.deletedAt).toBeFalsy();
  });

  // 実機で見つけた不具合の回帰テスト。起動した時点で既にゴミ箱・アーカイブにあった Wiki を戻したあと、
  // 別の Wiki を保存すると（wikiFiles が変わって索引の組み直しが走る）、起動時の索引に残っていた
  // フラグが付け直されて、戻したページがまたゴミ箱・アーカイブへ戻っていた
  it("起動時に既にゴミ箱・アーカイブだった Wiki を戻したあと、別の Wiki を保存してもフラグは戻らない", async () => {
    const env = setupProvider({ "w1": wikiDoc("知見A"), "w2": wikiDoc("知見B"), "w3": wikiDoc("知見C") });
    // 1 回目の起動: w2 をゴミ箱、w3 をアーカイブへ送って終了する
    const first = await renderFileManager(["w1", "w2", "w3"]);
    await waitFor(() => expect(first.result.current.getWikiIndexFlags("w2")).not.toBeNull());
    await act(async () => { await first.result.current.handleDeleteWikiFile("w2"); });
    await act(async () => { await first.result.current.handleArchiveWikiFile("w3"); });
    await waitFor(() => {
      const saved = env.appData.get("note-index") as { notes: { noteId: string; deletedAt?: string; archivedAt?: string }[] };
      expect(saved.notes.find((n) => n.noteId === "w2")?.deletedAt).toBeTruthy();
      expect(saved.notes.find((n) => n.noteId === "w3")?.archivedAt).toBeTruthy();
    });
    first.unmount();

    // 2 回目の起動: 起動時の索引は w2・w3 のフラグを持っている
    const { result } = await renderFileManager(["w1", "w2", "w3"]);
    await waitFor(() => expect(result.current.getWikiIndexFlags("w2")?.deletedAt).toBeTruthy());
    await waitFor(() => expect(result.current.getWikiIndexFlags("w3")?.archivedAt).toBeTruthy());

    await act(async () => { await result.current.restoreWikiIndexFlag("w2", "deletedAt"); });
    await act(async () => { await result.current.restoreWikiIndexFlag("w3", "archivedAt"); });
    expect(result.current.getWikiIndexFlags("w2")?.deletedAt).toBeNull();

    // 別の Wiki を保存 → wikiFiles が変わり、索引の組み直しが走る
    const w1 = result.current.getCachedDoc("wiki:w1")!;
    await act(async () => {
      await result.current.handleSaveWikiFile("w1", { ...w1, title: "知見A（改）" });
    });
    // 組み直し（全 Wiki の読み込みを待つ非同期処理）が終わるのを待つ
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    await waitFor(() => expect(result.current.wikiMetas.get("w1")?.title).toBe("知見A（改）"));

    expect(result.current.getWikiIndexFlags("w2")).toEqual({ deletedAt: null, archivedAt: null });
    expect(result.current.getWikiIndexFlags("w3")).toEqual({ deletedAt: null, archivedAt: null });
    expect(result.current.wikiFiles.map((f) => f.id).sort()).toEqual(["w1", "w2", "w3"]);
    // ディスクの索引にも付け直されていない
    await waitFor(() => {
      const saved = env.appData.get("note-index") as { notes: { noteId: string; deletedAt?: string; archivedAt?: string }[] };
      expect(saved.notes.find((n) => n.noteId === "w2")?.deletedAt).toBeFalsy();
      expect(saved.notes.find((n) => n.noteId === "w3")?.archivedAt).toBeFalsy();
    });
  });

  it("索引の組み直しの最中にゴミ箱へ送った Wiki は、組み直しのあともゴミ箱のまま", async () => {
    const env = setupProvider({ "w1": wikiDoc("知見A"), "w2": wikiDoc("知見B") });
    const { result } = await renderFileManager(["w1", "w2"]);
    await waitFor(() => expect(result.current.getWikiIndexFlags("w2")).not.toBeNull());

    // 保存（組み直しが始まる）→ 読み込みを待っているあいだにゴミ箱へ送る
    const w1 = result.current.getCachedDoc("wiki:w1")!;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    env.loadWikiFile.mockImplementation(async (fileId: string) => {
      await gate;
      const f = env.wikiFiles.get(fileId);
      if (!f) throw new Error(`wiki file not found: ${fileId}`);
      return structuredClone(f);
    });
    await act(async () => {
      await result.current.handleSaveWikiFile("w1", { ...w1, title: "知見A（改）" });
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    await act(async () => { await result.current.handleDeleteWikiFile("w2"); });
    expect(result.current.getWikiIndexFlags("w2")?.deletedAt).toBeTruthy();
    release();
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    expect(result.current.getWikiIndexFlags("w2")?.deletedAt).toBeTruthy();
    expect(result.current.trashedIdSet.has("w2")).toBe(true);
  });

  it("handleRestore: Wiki をゴミ箱から戻してもエラーログが出ない", async () => {
    setupProvider({ "w1": wikiDoc("知見A") });
    const { result } = await renderFileManager(["w1"]);
    await waitFor(() => expect(result.current.getWikiIndexFlags("w1")).not.toBeNull());
    await act(async () => { await result.current.handleDeleteWikiFile("w1"); });
    expect(result.current.trashedIdSet.has("w1")).toBe(true);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => { await result.current.handleRestore("w1"); });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(result.current.getWikiIndexFlags("w1")?.deletedAt).toBeNull();
    expect(result.current.wikiFiles.map((f) => f.id)).toEqual(["w1"]);
  });

  it("安定性: handleSaveWikiFile と 3 関数は再描画しても同一参照", async () => {
    setupProvider({ "w1": wikiDoc("知見A") });
    const { result, rerender } = await renderFileManager(["w1"]);
    const before = {
      save: result.current.handleSaveWikiFile,
      fresh: result.current.loadWikiDocFresh,
      flags: result.current.getWikiIndexFlags,
    };
    rerender();
    expect(result.current.handleSaveWikiFile).toBe(before.save);
    expect(result.current.loadWikiDocFresh).toBe(before.fresh);
    expect(result.current.getWikiIndexFlags).toBe(before.flags);
  });
});
