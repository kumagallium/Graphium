// @vitest-environment jsdom
// 保存経路の不変条件テスト（use-file-manager）
//
// 直近のデータ破壊バグ（PR #454 ほか）の再発防止として、ノート保存経路の
// 不変条件をフックを実際にマウントして検証する:
//   1. activeFileId が set なら必ず saveFile（createFile に倒すと新 id で複製）
//   2. refreshFiles は一覧取得失敗時に files を空にしない（空に見えると
//      直後のオートセーブが新規作成分岐へ落ちて複製事故になる）
//   3. 空の保管庫でも mediaIndex は null のまま放置されない（null は素材
//      ギャラリーでは「読み込み中」として描画されるので、DL 直後に固まる）
//
// テスト環境メモ: プロジェクト既定の vitest 環境は node なので、
// 先頭の @vitest-environment ディレクティブで per-file に jsdom を指定する。
// save-path-test-polyfills は import チェーン（asset-browser → pdfjs-dist）が
// 参照する Canvas 系グローバルのスタブ。

import "./save-path-test-polyfills";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useFileManager } from "./use-file-manager";
import { registerProvider, setActiveProvider } from "../lib/storage/registry";
import type { StorageProvider } from "../lib/storage/types";
import type { GraphiumDocument, GraphiumFile } from "../lib/document-types";

// React 18 の act() 警告を抑止（テストランナーが act 環境であることを明示）
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// テスト用のインメモリ StorageProvider
// ---------------------------------------------------------------------------

type StoredFile = {
  doc: GraphiumDocument;
  createdTime: string;
  modifiedTime: string;
};

function mockDoc(title: string, overrides: Partial<GraphiumDocument> = {}): GraphiumDocument {
  return {
    version: 2,
    title,
    pages: [
      {
        id: "page-1",
        title: "Main",
        blocks: [
          {
            id: "b1",
            type: "paragraph",
            content: [{ type: "text", text: `${title} の本文` }],
          },
        ],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    createdAt: "2026-01-01T00:00:00Z",
    modifiedAt: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

/**
 * StorageProvider 準拠のインメモリ実装。
 * - files: ノート本体（Map<id, StoredFile>）
 * - appData: note-index / media-index 等の内部メタデータ
 * - calls: saveFile / createFile の呼び出し履歴（不変条件の検証に使う）
 * - mediaFiles: アップロード済み素材（listMediaFiles が返す。既定は空）
 * - failListFiles: listFiles の transient 失敗をシミュレートするフラグ
 * Wiki / Skill のオプショナルメソッドは意図的に未実装
 * （use-file-manager 側はオプショナル扱いなので安全にスキップされる）。
 */
function createMockProvider(seed: Record<string, GraphiumDocument> = {}) {
  const files = new Map<string, StoredFile>();
  for (const [id, doc] of Object.entries(seed)) {
    files.set(id, {
      doc: structuredClone(doc),
      createdTime: doc.createdAt ?? "2026-01-01T00:00:00Z",
      modifiedTime: doc.modifiedAt ?? "2026-01-02T00:00:00Z",
    });
  }
  const appData = new Map<string, unknown>();
  const calls = {
    saveFile: [] as string[],
    createFile: [] as string[],
  };
  const flags = { failListFiles: false };
  const mediaFiles: { id: string; name: string; mimeType: string; createdTime: string }[] = [];
  let idCounter = 0;

  const provider = {
    id: "test-mem",
    displayName: "Test In-Memory",

    async init() {},
    signIn() {},
    signOut() {},
    getAuthState: () => ({ isSignedIn: true, userEmail: "test@example.com" }),
    onAuthChange: () => () => {},

    async listFiles(): Promise<GraphiumFile[]> {
      if (flags.failListFiles) throw new Error("transient list failure");
      return Array.from(files.entries()).map(([id, f]) => ({
        id,
        name: `${f.doc.title}.graphium.json`,
        modifiedTime: f.modifiedTime,
        createdTime: f.createdTime,
      }));
    },
    async loadFile(fileId: string): Promise<GraphiumDocument> {
      const f = files.get(fileId);
      if (!f) throw new Error(`file not found: ${fileId}`);
      return structuredClone(f.doc);
    },
    async createFile(_title: string, content: GraphiumDocument): Promise<string> {
      const id = `created-${++idCounter}`;
      calls.createFile.push(id);
      const now = new Date().toISOString();
      files.set(id, { doc: structuredClone(content), createdTime: now, modifiedTime: now });
      return id;
    },
    async saveFile(fileId: string, content: GraphiumDocument): Promise<void> {
      calls.saveFile.push(fileId);
      const existing = files.get(fileId);
      files.set(fileId, {
        doc: structuredClone(content),
        createdTime: existing?.createdTime ?? new Date().toISOString(),
        modifiedTime: new Date().toISOString(),
      });
    },
    async deleteFile(fileId: string): Promise<void> {
      files.delete(fileId);
    },

    async uploadMedia(): Promise<never> {
      throw new Error("uploadMedia is not expected in these tests");
    },
    async getMediaBlobUrl(): Promise<never> {
      throw new Error("getMediaBlobUrl is not expected in these tests");
    },
    extractFileId: () => null,
    getUserEmail: async () => "test@example.com",
    // これが無いと ensureMediaIndex が Drive API（authedFetch）へフォールバックする。
    // local / server-fs 等の実プロバイダは全て実装しているので、実装済みとして扱う。
    async listMediaFiles(): Promise<{ id: string; name: string; mimeType: string; createdTime: string }[]> {
      return mediaFiles.map((m) => ({ ...m }));
    },
    async authedFetch(): Promise<never> {
      // readAppData / writeAppData を実装しているので、index 系がここへ
      // フォールバックしてきたら設計の前提が壊れている
      throw new Error("authedFetch should not be called (readAppData/writeAppData are implemented)");
    },

    async readAppData(key: string): Promise<unknown | null> {
      return appData.has(key) ? structuredClone(appData.get(key)) : null;
    },
    async writeAppData(key: string, data: unknown): Promise<void> {
      appData.set(key, structuredClone(data));
    },

    clearCache() {},
  } as unknown as StorageProvider;

  return { provider, files, appData, calls, flags, mediaFiles };
}

function setupProvider(seed: Record<string, GraphiumDocument> = {}) {
  const mock = createMockProvider(seed);
  registerProvider(mock.provider); // 同一 id の再登録は上書き → テストごとに新品になる
  setActiveProvider("test-mem");
  return mock;
}

async function renderFileManager() {
  const hook = renderHook(() => useFileManager(true));
  // マウント時の refreshFiles（一覧取得）が完了するまで待つ
  await waitFor(() => {
    expect(hook.result.current.filesLoading).toBe(false);
  });
  return hook;
}

beforeEach(() => {
  // graphium_last_file / recent notes / provider 選択などの持ち越しを防ぐ
  localStorage.clear();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 不変条件 1: activeFileId が set なら必ず saveFile（PR #454）
// ---------------------------------------------------------------------------

describe("useFileManager: activeFileId が set なら必ず saveFile（PR #454 再発防止）", () => {
  it("開いているノートの保存は同じ id へ saveFile され、createFile は呼ばれない", async () => {
    const mock = setupProvider({ "note-1": mockDoc("最初のノート") });
    const { result } = await renderFileManager();

    await act(async () => {
      await result.current.handleOpenFile("note-1");
    });
    await waitFor(() => {
      expect(result.current.activeFileId).toBe("note-1");
    });

    const edited = mockDoc("編集後のノート");
    await act(async () => {
      await result.current.handleSave(edited);
    });

    // 上書き保存であり、新規作成（= 新 id での複製）ではないこと
    expect(mock.calls.saveFile).toEqual(["note-1"]);
    expect(mock.calls.createFile).toEqual([]);
    // ストレージ上もノートは 1 件のまま、内容が更新されている
    expect(mock.files.size).toBe(1);
    expect(mock.files.get("note-1")?.doc.title).toBe("編集後のノート");
  });

  it("一覧取得が transient に失敗した直後の保存でも、複製ではなく上書きになる", async () => {
    // PR #454 の実バグシナリオ:
    // sidecar の一時エラー等で listFiles が失敗 → 一覧が空に見える →
    // 直後のオートセーブが新規作成分岐に落ち、開いているノートが新 id で複製される。
    const mock = setupProvider({ "note-1": mockDoc("最初のノート") });
    const { result } = await renderFileManager();

    await act(async () => {
      await result.current.handleOpenFile("note-1");
    });
    await waitFor(() => {
      expect(result.current.activeFileId).toBe("note-1");
    });

    // 一覧取得を失敗させてから refreshFiles（= transient 失敗の再現）
    mock.flags.failListFiles = true;
    await act(async () => {
      await result.current.refreshFiles();
    });

    const edited = mockDoc("失敗直後の編集");
    await act(async () => {
      await result.current.handleSave(edited);
    });

    expect(mock.calls.createFile).toEqual([]);
    expect(mock.calls.saveFile).toEqual(["note-1"]);
    // 複製が生まれていない（ノートは 1 件のまま）
    expect(mock.files.size).toBe(1);
    expect(mock.files.get("note-1")?.doc.title).toBe("失敗直後の編集");
  });

  it("新規ノートは初回保存で createFile、2 回目以降は新 id へ saveFile（複製を作らない）", async () => {
    const mock = setupProvider();
    const { result } = await renderFileManager();
    expect(result.current.activeFileId).toBeNull();

    // 初回保存 → createFile で新 id が発行され、activeFileId に反映される
    await act(async () => {
      await result.current.handleSave(mockDoc("新しいノート"));
    });
    expect(mock.calls.createFile).toEqual(["created-1"]);
    await waitFor(() => {
      expect(result.current.activeFileId).toBe("created-1");
    });

    // 2 回目の保存 → 同じ id へ saveFile（createFile が再度呼ばれたら保存のたびに複製される）
    await act(async () => {
      await result.current.handleSave(mockDoc("新しいノート 更新"));
    });
    expect(mock.calls.createFile).toEqual(["created-1"]); // 増えていない
    expect(mock.calls.saveFile).toEqual(["created-1"]);
    expect(mock.files.size).toBe(1);
    expect(mock.files.get("created-1")?.doc.title).toBe("新しいノート 更新");
  });
});

// ---------------------------------------------------------------------------
// 不変条件 2: refreshFiles は一覧取得失敗時に files を空にしない（PR #454）
// ---------------------------------------------------------------------------

describe("useFileManager: refreshFiles は list 失敗時に files を空にしない（PR #454 再発防止）", () => {
  it("listFiles が失敗しても直前のノート一覧を保持する", async () => {
    const mock = setupProvider({
      "note-1": mockDoc("ノート 1"),
      "note-2": mockDoc("ノート 2"),
    });
    const { result } = await renderFileManager();
    await waitFor(() => {
      expect(result.current.files).toHaveLength(2);
    });

    mock.flags.failListFiles = true;
    await act(async () => {
      await result.current.refreshFiles();
    });

    // 一覧が空に上書きされていない（空に見えると上書き/複製事故につながる）
    expect(result.current.files).toHaveLength(2);
    expect(result.current.files.map((f) => f.id).sort()).toEqual(["note-1", "note-2"]);
    // ローディング状態も解除されている（張り付くと UI が固まる）
    expect(result.current.filesLoading).toBe(false);
  });

  it("失敗から復帰した refreshFiles で一覧が最新化される", async () => {
    const mock = setupProvider({ "note-1": mockDoc("ノート 1") });
    const { result } = await renderFileManager();
    await waitFor(() => {
      expect(result.current.files).toHaveLength(1);
    });

    // 失敗 → 保持
    mock.flags.failListFiles = true;
    await act(async () => {
      await result.current.refreshFiles();
    });
    expect(result.current.files).toHaveLength(1);

    // 復帰 + サーバー側に 1 件増えている → 正常に反映される
    mock.flags.failListFiles = false;
    mock.files.set("note-2", {
      doc: mockDoc("ノート 2"),
      createdTime: "2026-01-03T00:00:00Z",
      modifiedTime: "2026-01-03T00:00:00Z",
    });
    await act(async () => {
      await result.current.refreshFiles();
    });
    await waitFor(() => {
      expect(result.current.files).toHaveLength(2);
    });
  });
});

// ---------------------------------------------------------------------------
// 不変条件 3: 空の保管庫でも mediaIndex は確定する
// ---------------------------------------------------------------------------

describe("useFileManager: 空状態でも mediaIndex が確定する（素材ギャラリー固着 再発防止）", () => {
  it("ノート 0 件・素材 0 件でも mediaIndex が空インデックスとして確定する", async () => {
    // 実バグ: 完全構築の effect が files.length === 0 で早期 return していたため、
    // DL 直後（ノートも media-index ファイルも無い）は mediaIndex が null のまま
    // 残り、AssetGalleryView が「読み込み中」を出し続けていた。
    setupProvider();
    const { result } = await renderFileManager();

    await waitFor(() => {
      expect(result.current.mediaIndex).not.toBeNull();
    });
    expect(result.current.mediaIndex?.media).toEqual([]);
  });

  it("ノートが 1 件も無くてもアップロード済み素材が mediaIndex に載る", async () => {
    // 素材はノートと独立にアップロードできるので、ノート 0 件でも走査は必要。
    const mock = setupProvider();
    mock.mediaFiles.push({
      id: "media-1",
      name: "sample.png",
      mimeType: "image/png",
      createdTime: "2026-01-01T00:00:00Z",
    });
    const { result } = await renderFileManager();

    await waitFor(() => {
      expect(result.current.mediaIndex?.media).toHaveLength(1);
    });
    expect(result.current.mediaIndex?.media[0]).toMatchObject({
      fileId: "media-1",
      name: "sample.png",
      type: "image",
      usedIn: [],
    });
  });
});
