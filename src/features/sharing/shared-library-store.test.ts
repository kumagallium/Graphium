// 共有ストア（読み出しの単一入口）のテスト
// - refresh は同時に呼ばれても 1 回しか読まない
// - 読み出し中の変更通知は取りこぼさない（終わってからもう一度読む）
// - readSharedEntryBody は hash を照合し、不一致を mismatched に残す
// - 本文は id|hash でキャッシュされ、二度読まない

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SharedEntry, SharedEntryContent, SharedEntryType } from "../../lib/storage/shared";
import { computeSharedEntryHash } from "../../lib/storage/shared/hash";
import type { SharedLibraryLoadResult } from "./shared-library-loader";
import {
  __setSharedLibraryLoaderForTest,
  getSharedLibrarySnapshot,
  notifySharedLibraryChanged,
  readSharedEntryBody,
  refreshSharedLibrary,
  subscribeSharedLibrary,
  groupSharedEntriesByType,
} from "./shared-library-store";

const ROOT = "/tmp/shared-root";

const entry = (over: Partial<SharedEntry>): SharedEntry =>
  ({
    id: "0195e000-0000-7000-8000-000000000001",
    type: "note",
    author: { name: "Ada", email: "a@b.co" },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    hash: "sha256:dummy",
    prov: { derived_from: [] },
    ...over,
  }) as SharedEntry;

const result = (entries: SharedEntry[], errors: Partial<Record<SharedEntryType, string>> = {}): SharedLibraryLoadResult => {
  const byType = groupSharedEntriesByType(entries);
  return { entries: byType, errors };
};

/** hash が本文と整合した entry を作る（provider が返すもの） */
async function signedEntry(body: Uint8Array, over: Partial<SharedEntry> = {}): Promise<SharedEntry> {
  const base = entry({ hash: "", ...over });
  const hash = await computeSharedEntryHash(base, body);
  return { ...base, hash };
}

beforeEach(() => {
  __setSharedLibraryLoaderForTest(null, { root: ROOT });
});

describe("refreshSharedLibrary", () => {
  it("同時に呼んでもローダーは 1 回だけ走る", async () => {
    const load = vi.fn(async () => result([entry({ id: "a" })]));
    __setSharedLibraryLoaderForTest(load, { root: ROOT });
    const [s1, s2] = await Promise.all([refreshSharedLibrary(), refreshSharedLibrary()]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(s1).toBe(s2);
    expect(getSharedLibrarySnapshot().entries.map((e) => e.id)).toEqual(["a"]);
    expect(getSharedLibrarySnapshot().loadedAt).not.toBeNull();
    expect(getSharedLibrarySnapshot().loading).toBe(false);
  });

  it("ルート未設定なら読まずに空スナップショットになる", async () => {
    const load = vi.fn(async () => result([entry({ id: "a" })]));
    __setSharedLibraryLoaderForTest(load, { root: null });
    const snap = await refreshSharedLibrary();
    expect(load).not.toHaveBeenCalled();
    expect(snap.entries).toEqual([]);
    expect(snap.root).toBeNull();
  });

  it("購読者に変化が伝わる", async () => {
    const load = vi.fn(async () => result([entry({ id: "a" })]));
    __setSharedLibraryLoaderForTest(load, { root: ROOT });
    const seen: number[] = [];
    const unsubscribe = subscribeSharedLibrary(() => seen.push(getSharedLibrarySnapshot().entries.length));
    await refreshSharedLibrary();
    unsubscribe();
    // loading=true → 読み終わり の 2 回
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen[seen.length - 1]).toBe(1);
    const afterUnsubscribe = seen.length;
    await refreshSharedLibrary();
    expect(seen.length).toBe(afterUnsubscribe); // 解除後は呼ばれない
  });

  it("type ごとのエラーをそのまま持つ", async () => {
    __setSharedLibraryLoaderForTest(async () => result([], { knowledge: "boom" }), { root: ROOT });
    const snap = await refreshSharedLibrary();
    expect(snap.errors.knowledge).toBe("boom");
  });

  it("ローダー自体が落ちたら、note だけでなく全 type にエラーを立てる", async () => {
    __setSharedLibraryLoaderForTest(async () => {
      throw new Error("boom");
    }, { root: ROOT });
    const snap = await refreshSharedLibrary();
    // どの type も読めていないので、どのタブを見てもエラーが見える状態にする
    expect(snap.errors).toEqual({
      note: "boom",
      reference: "boom",
      "data-manifest": "boom",
      template: "boom",
      knowledge: "boom",
      report: "boom",
    });
    expect(snap.loading).toBe(false);
    // 読めていないので「読み終えた時刻」は付かない（索引側が空一覧で走らないため）
    expect(snap.loadedAt).toBeNull();
  });

  it("読み出し中に来た変更通知は、終わってからもう一度読み直す", async () => {
    let calls = 0;
    const load = vi.fn(async () => {
      calls++;
      // 1 回目の読み出しの最中に共有操作が起きた状況を作る
      if (calls === 1) notifySharedLibraryChanged();
      await new Promise((r) => setTimeout(r, 0));
      return result([entry({ id: `a${calls}` })]);
    });
    __setSharedLibraryLoaderForTest(load, { root: ROOT });
    const snap = await refreshSharedLibrary();
    expect(load).toHaveBeenCalledTimes(2);
    expect(snap.entries.map((e) => e.id)).toEqual(["a2"]);
  });
});

describe("readSharedEntryBody", () => {
  it("hash が一致すれば verified、本文はキャッシュされ二度読まない", async () => {
    const body = new TextEncoder().encode('{"title":"x","pages":[]}');
    const e = await signedEntry(body, { id: "0195e000-0000-7000-8000-00000000000a" });
    const reader = vi.fn(async (): Promise<SharedEntryContent> => ({ entry: e, body }));
    __setSharedLibraryLoaderForTest(async () => result([e]), { root: ROOT, reader });

    const first = await readSharedEntryBody(e);
    const second = await readSharedEntryBody(e);
    expect(first.verified).toBe(true);
    expect(second.body).toBe(first.body);
    expect(reader).toHaveBeenCalledTimes(1);
    expect(getSharedLibrarySnapshot().mismatched).toEqual([]);
  });

  it("hash が合わなければ verified=false で mismatched に載る", async () => {
    const body = new TextEncoder().encode("tampered");
    const stored = await signedEntry(body, { id: "0195e000-0000-7000-8000-00000000000b" });
    // 一覧が持っている hash（fingerprint）と実体が食い違っている状態
    const listed = { ...stored, hash: "sha256:stale" };
    let listing: SharedEntry[] = [listed];
    __setSharedLibraryLoaderForTest(async () => result(listing), {
      root: ROOT,
      reader: async () => ({ entry: stored, body }),
    });
    await refreshSharedLibrary();
    const read = await readSharedEntryBody(listed);
    expect(read.verified).toBe(false);
    expect(getSharedLibrarySnapshot().mismatched).toEqual([listed.id]);

    // エントリが共有ルートから消えたら不一致の記録も落とす
    listing = [];
    await refreshSharedLibrary();
    expect(getSharedLibrarySnapshot().mismatched).toEqual([]);
  });

  it("ルート未設定では読めない", async () => {
    __setSharedLibraryLoaderForTest(null, { root: null });
    await expect(readSharedEntryBody(entry({}))).rejects.toThrow(/shared root/);
  });
});
