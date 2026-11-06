// @vitest-environment jsdom
// 共有の書き込み先の規則（共有フォルダが複数あるとき）のテスト。
// - 初回共有 → 既定の共有先
// - 再共有（自分の共有コピーの更新）→ そのコピーがあるフォルダ
// - コピーの居場所が分からず、読めないフォルダがあるとき → 書かない（null）

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SharedEntry, SharedEntryType } from "../../lib/storage/shared";
import { setSharedRoot } from "../../lib/storage/shared/config";
import type { SharedLibraryLoadResult } from "./shared-library-loader";
import {
  __setSharedLibraryLoaderForTest,
  groupSharedEntriesByType,
  refreshSharedLibrary,
  resolveOwnCopyRoot,
} from "./shared-library-store";
import { resolveShareTarget } from "./share-target";

const ORG = "/mnt/org";
const DEPT = "/mnt/dept";

const entry = (id: string): SharedEntry =>
  ({
    id,
    type: "note",
    author: { name: "Ada", email: "a@b.co" },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    hash: "sha256:dummy",
    prov: { derived_from: [] },
  }) as SharedEntry;

const result = (entries: SharedEntry[]): SharedLibraryLoadResult => ({
  entries: groupSharedEntriesByType(entries),
  errors: {} as Partial<Record<SharedEntryType, string>>,
});

beforeEach(() => {
  localStorage.clear();
  setSharedRoot(ORG);
});

afterEach(() => {
  __setSharedLibraryLoaderForTest(null, { root: null });
  localStorage.clear();
});

describe("resolveOwnCopyRoot / resolveShareTarget", () => {
  it("初回共有は既定の共有先へ", async () => {
    __setSharedLibraryLoaderForTest(async () => result([]), { roots: [ORG, DEPT] });
    expect((await resolveShareTarget(undefined))?.root).toBe(ORG);
  });

  it("再共有は、共有コピーがあるフォルダへ", async () => {
    __setSharedLibraryLoaderForTest(
      async (root) => (root === DEPT ? result([entry("mine")]) : result([])),
      { roots: [ORG, DEPT] },
    );
    await refreshSharedLibrary();
    expect(resolveOwnCopyRoot("mine")).toBe(DEPT);
    expect((await resolveShareTarget("mine"))?.root).toBe(DEPT);
  });

  it("居場所が一覧に無く、全フォルダが読めているなら既定の共有先", async () => {
    __setSharedLibraryLoaderForTest(async () => result([]), { roots: [ORG, DEPT] });
    await refreshSharedLibrary();
    expect((await resolveShareTarget("unknown"))?.root).toBe(ORG);
  });

  it("居場所が一覧に無く、読めないフォルダがあるなら書かない（null）", async () => {
    __setSharedLibraryLoaderForTest(
      async (root) => {
        if (root === DEPT) throw new Error("not mounted");
        return result([]);
      },
      { roots: [ORG, DEPT] },
    );
    await refreshSharedLibrary();
    expect(resolveOwnCopyRoot("mine")).toBeNull();
    expect(await resolveShareTarget("mine")).toBeNull();
  });

  it("コピーがある側が読めているなら、他のフォルダが届かなくてもそこへ書ける", async () => {
    __setSharedLibraryLoaderForTest(
      async (root) => {
        if (root === DEPT) throw new Error("not mounted");
        return result([entry("mine")]);
      },
      { roots: [ORG, DEPT] },
    );
    await refreshSharedLibrary();
    expect((await resolveShareTarget("mine"))?.root).toBe(ORG);
  });
});

describe("一覧を読み終える前の再共有（§26）", () => {
  it("まだ読んでいなくても、読み終えてからコピーのあるフォルダを選ぶ（既定の共有先へ二重に作らない）", async () => {
    __setSharedLibraryLoaderForTest(
      async (root) => (root === DEPT ? result([entry("mine")]) : result([])),
      { roots: [ORG, DEPT] },
    );
    // refresh を呼ばずにいきなり再共有先を引く
    expect((await resolveShareTarget("mine"))?.root).toBe(DEPT);
  });
});
