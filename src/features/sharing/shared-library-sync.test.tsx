// @vitest-environment jsdom
// useSharedLibrarySync（共有ライブラリ → 語彙索引 shared レーン）の配線テスト。
//
// 対象の不変条件:
// - 共有ルートの読み込みが終わるまで reconcile を走らせない
//   （空一覧で走ると前回セッションの shared 索引が消え、直後に全件読み直しになる）
// - 読み終わったら、その一覧で 1 回だけ reconcile する
// - スイッチ OFF のときは読み込みを待たずに空一覧で reconcile する（掃除が目的）
//
// lexicalSearch と埋め込みはモック（IndexedDB には触れない）。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { SharedEntry, SharedEntryType } from "../../lib/storage/shared";
import type { SharedLibraryLoadResult } from "./shared-library-loader";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  aiEnabled: true,
  ensureLoaded: vi.fn(async () => {}),
  reconcile: vi.fn(async (..._args: unknown[]) => {}),
  syncEmbeddings: vi.fn(async () => {}),
  readBody: vi.fn(async (..._args: unknown[]) => ({ body: new Uint8Array(), verified: true })),
}));

vi.mock("../lexical-search", () => ({
  currentScopeKey: () => "scope-1",
  useLexicalStatus: () => ({ generation: 0 }),
  desiredSharedSources: (entries: SharedEntry[]) =>
    entries.map((e) => ({ kind: "shared", sourceId: e.id, fingerprint: `${e.hash}|${e.type}` })),
  lexicalSearch: { ensureLoaded: h.ensureLoaded, reconcile: h.reconcile },
}));
vi.mock("./shared-embeddings", () => ({ syncSharedKnowledgeEmbeddings: h.syncEmbeddings }));
// 本文の読み出しだけ差し替える（ストアの状態と DI ローダーは本物のまま使う）
vi.mock("./shared-library-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./shared-library-store")>()),
  readSharedEntryBody: h.readBody,
}));
vi.mock("../../lib/storage/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/storage/shared")>()),
  getSharedAiEnabled: () => h.aiEnabled,
}));

import { useSharedLibrarySync } from "./shared-library-sync";
import { __setSharedLibraryLoaderForTest, groupSharedEntriesByType } from "./shared-library-store";
import {
  __resetSharedProjectionForTest,
  getSharedProjection,
} from "./shared-projection";
import type { GraphiumDocument } from "../../lib/document-types";

const ROOT = "/tmp/shared-root";

const entry = (id: string): SharedEntry =>
  ({
    id,
    type: "note" as SharedEntryType,
    author: { name: "Ada", email: "a@b.co" },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    hash: `sha256:${id}`,
    prov: { derived_from: [] },
  }) as SharedEntry;

const result = (entries: SharedEntry[]): SharedLibraryLoadResult => ({
  entries: groupSharedEntriesByType(entries),
  errors: {},
});

/** タイマーを進めてから、その中で走る非同期処理（await 連鎖）を流し切る */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  h.aiEnabled = true;
  h.ensureLoaded.mockClear();
  h.reconcile.mockClear();
  h.syncEmbeddings.mockClear();
  h.readBody.mockClear();
  __resetSharedProjectionForTest();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  __setSharedLibraryLoaderForTest(null, { root: null });
});

describe("useSharedLibrarySync", () => {
  it("共有ルートを読み終えるまで reconcile しない（読み終えたら中身つきで 1 回）", async () => {
    let finish: ((r: SharedLibraryLoadResult) => void) | null = null;
    const load = vi.fn(
      () =>
        new Promise<SharedLibraryLoadResult>((resolve) => {
          finish = resolve;
        }),
    );
    __setSharedLibraryLoaderForTest(load, { root: ROOT });

    renderHook(() => useSharedLibrarySync({ authenticated: true }));
    // デバウンス（1500ms）を大きく超えても、読み込み中は索引に触らない
    await advance(5000);
    expect(h.reconcile).not.toHaveBeenCalled();

    await act(async () => {
      finish?.(result([entry("a"), entry("b")]));
      await Promise.resolve();
      await Promise.resolve();
    });
    await advance(2000);

    expect(h.reconcile).toHaveBeenCalledTimes(1);
    const desired = h.reconcile.mock.calls[0][0] as { sourceId: string }[];
    expect(desired.map((d) => d.sourceId)).toEqual(["a", "b"]);
    expect(h.reconcile.mock.calls[0][2]).toMatchObject({ kinds: ["shared"] });
  });

  it("スイッチ OFF なら読み込みを待たずに空一覧で reconcile する（索引の掃除）", async () => {
    h.aiEnabled = false;
    const load = vi.fn(() => new Promise<SharedLibraryLoadResult>(() => {}));
    __setSharedLibraryLoaderForTest(load, { root: ROOT });

    renderHook(() => useSharedLibrarySync({ authenticated: true }));
    await advance(2000);

    expect(h.reconcile).toHaveBeenCalledTimes(1);
    expect(h.reconcile.mock.calls[0][0]).toEqual([]);
  });

  it("読んだ本文は 1 回だけパースして索引と投影の両方に配る", async () => {
    const noteDoc: GraphiumDocument = {
      version: 6,
      title: "焼成の記録",
      pages: [
        {
          id: "p1",
          title: "焼成の記録",
          blocks: [
            {
              id: "s1",
              type: "step",
              content: [{ type: "text", text: "焼成", styles: {} }],
              children: [],
            },
          ],
          labels: {},
          provLinks: [],
          knowledgeLinks: [],
        },
      ],
    } as any;
    h.readBody.mockResolvedValue({
      body: new TextEncoder().encode(JSON.stringify(noteDoc)),
      verified: true,
    });
    // reconcile は「stale なソースを loader で読む」ところだけ本物と同じに振る舞わせる
    h.reconcile.mockImplementation(async (...args: unknown[]) => {
      const [desired, loader] = args as [
        { sourceId: string }[],
        (d: { sourceId: string }) => Promise<unknown>,
      ];
      for (const d of desired) await loader(d);
    });
    __setSharedLibraryLoaderForTest(async () => result([entry("a")]), { root: ROOT });

    const parseSpy = vi.spyOn(JSON, "parse");
    renderHook(() => useSharedLibrarySync({ authenticated: true }));
    // 1 回目: 共有ルートの読み込みが片付く（ここで初めて reconcile が仕掛かる）
    await advance(2000);
    await advance(2000);

    // 索引（sharedEntryToSourceInput）と投影（recordSharedProjectionFromBody）が
    // 別々にパースすると 2 回になる
    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(h.readBody).toHaveBeenCalledTimes(1);
    expect(Object.keys(getSharedProjection().entries)).toEqual(["a"]);
    parseSpy.mockRestore();
    h.reconcile.mockReset();
    h.reconcile.mockImplementation(async () => {});
  });

  it("共有ルート未設定なら空一覧で reconcile する（旧ルートの残留を消す）", async () => {
    __setSharedLibraryLoaderForTest(null, { root: null });
    renderHook(() => useSharedLibrarySync({ authenticated: true }));
    await advance(2000);
    expect(h.reconcile).toHaveBeenCalledTimes(1);
    expect(h.reconcile.mock.calls[0][0]).toEqual([]);
  });
});
