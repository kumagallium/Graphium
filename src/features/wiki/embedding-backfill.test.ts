// 埋め込み後追いのテスト（対象の選び方・上限・モデル未設定・失敗の扱い・0 セクションを数えない・後回し）
import { describe, expect, it, vi } from "vitest";

vi.mock("../settings/store", () => ({ getEmbeddingModel: () => "", getSelectedModel: () => "" }));
vi.mock("../../lib/embedding-store", () => ({ embeddingStore: { listDocumentIds: async () => new Set<string>() } }));
vi.mock("../../lib/sidecar", () => ({ getSidecarState: () => ({ status: "ready" }), subscribeSidecarState: () => () => {} }));

import {
  BACKFILL_DEFERRED_KEY,
  loadDeferredIds,
  runEmbeddingBackfill,
  saveDeferredIds,
  selectBackfillTargets,
} from "./embedding-backfill";

const doc = {} as never;
const quiet = () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
};

describe("selectBackfillTargets", () => {
  it("埋め込みの無い ID だけを順番に選ぶ", () => {
    expect(selectBackfillTargets(["a", "b", "c"], new Set(["b"]))).toEqual(["a", "c"]);
  });
  it("上限で打ち切る", () => {
    expect(selectBackfillTargets(["a", "b", "c"], new Set(), 2)).toEqual(["a", "b"]);
  });
  it("後回しのページは除かず、ほかのページの後ろに回す", () => {
    expect(selectBackfillTargets(["a", "b", "c", "d"], new Set(["c"]), 10, new Set(["a", "b"]))).toEqual(["d", "a", "b"]);
  });
  it("後回しのページは上限の残りの枠にだけ入る", () => {
    expect(selectBackfillTargets(["a", "b", "c"], new Set(), 2, new Set(["a"]))).toEqual(["b", "c"]);
  });
});

describe("runEmbeddingBackfill", () => {
  const base = {
    hasEmbeddingModel: () => true,
    loadDoc: async () => doc,
    listEmbeddedIds: async () => new Set<string>(),
    loadDeferred: () => new Set<string>(),
    saveDeferred: () => {},
  };

  it("モデル未設定なら何もしない", async () => {
    const embed = vi.fn(async () => 1);
    expect(await runEmbeddingBackfill({ ...base, hasEmbeddingModel: () => false, wikiIds: ["a"], embed })).toBe(0);
    expect(embed).not.toHaveBeenCalled();
  });

  it("準備ができていなければ何もしない", async () => {
    quiet();
    const embed = vi.fn(async () => 1);
    expect(await runEmbeddingBackfill({ ...base, wikiIds: ["a"], embed, waitReady: async () => false })).toBe(0);
    expect(embed).not.toHaveBeenCalled();
  });

  it("1 件の失敗は飛ばして次へ進み、そのページを後回しに記録する", async () => {
    quiet();
    const order: string[] = [];
    const embed = vi.fn(async (id: string) => {
      order.push(id);
      if (id === "b") throw new Error("x");
      return 1;
    });
    let saved: string[] = [];
    const n = await runEmbeddingBackfill({ ...base, wikiIds: ["a", "b", "c"], embed, saveDeferred: (ids) => { saved = [...ids]; } });
    expect(order).toEqual(["a", "b", "c"]);
    expect(n).toBe(2);
    expect(saved).toEqual(["b"]);
  });

  it("続けて失敗したら残りは中止する（サイドカー未起動・429 など）", async () => {
    quiet();
    const order: string[] = [];
    const embed = vi.fn(async (id: string) => {
      order.push(id);
      throw new Error("down");
    });
    let saved: string[] = [];
    const n = await runEmbeddingBackfill({ ...base, wikiIds: ["a", "b", "c", "d"], embed, saveDeferred: (ids) => { saved = [...ids]; } });
    expect(order).toEqual(["a", "b"]);
    expect(n).toBe(0);
    expect(saved).toEqual(["a", "b"]);
  });

  it("再現: 毎回失敗するページが先頭にあっても、起動を重ねると先へ進む", async () => {
    quiet();
    // 以前は 1 件目の失敗で起動ごと止まり、次の起動も同じページが先頭に来て永久に進まなかった
    const wikiIds = ["bad1", "bad2", ...Array.from({ length: 6 }, (_, i) => `p${i}`)];
    const embedded = new Set<string>();
    let deferred = new Set<string>();
    const embed = async (id: string) => {
      if (id.startsWith("bad")) throw new Error("rejected");
      embedded.add(id);
      return 1;
    };
    const launch = () =>
      runEmbeddingBackfill({
        ...base,
        wikiIds,
        embed,
        limit: 3,
        listEmbeddedIds: async () => new Set(embedded),
        loadDeferred: () => new Set(deferred),
        saveDeferred: (ids) => { deferred = new Set(ids); },
      });
    // 1 回目: bad1・bad2 が続けて落ちて止まる（全部が落ちる失敗と区別がつかないので、ここは止まってよい）
    expect(await launch()).toBe(0);
    // 2 回目以降: 落ちたページは後ろに回るので、残りのページが進む
    expect(await launch()).toBe(3);
    expect(await launch()).toBe(3);
    expect([...embedded].sort()).toEqual(["p0", "p1", "p2", "p3", "p4", "p5"]);
    expect([...deferred].sort()).toEqual(["bad1", "bad2"]);
  });

  it("成功したページは後回しの記録から消す", async () => {
    quiet();
    let saved: string[] | undefined;
    await runEmbeddingBackfill({
      ...base,
      wikiIds: ["a", "b"],
      embed: async () => 1,
      loadDeferred: () => new Set(["a"]),
      saveDeferred: (ids) => { saved = [...ids]; },
    });
    expect(saved).toEqual([]);
  });

  it("再現: セクション 0 件のページが先頭に溜まっても、読み込み上限の枠を食い続けない", async () => {
    quiet();
    const wikiIds = [...Array.from({ length: 4 }, (_, i) => `empty${i}`), "a", "b"];
    const embedded = new Set<string>();
    let deferred = new Set<string>();
    const embed = async (id: string) => {
      if (id.startsWith("empty")) return 0;
      embedded.add(id);
      return 1;
    };
    const launch = () =>
      runEmbeddingBackfill({
        ...base,
        wikiIds,
        embed,
        loadLimit: 4,
        listEmbeddedIds: async () => new Set(embedded),
        loadDeferred: () => new Set(deferred),
        saveDeferred: (ids) => { deferred = new Set(ids); },
      });
    // 1 回目は 0 件のページで読み込み枠が尽きる
    expect(await launch()).toBe(0);
    // 2 回目は後ろに回ったので a・b に届く
    expect(await launch()).toBe(2);
    expect([...embedded].sort()).toEqual(["a", "b"]);
  });

  it("セクション 0 件（戻り値 0）は件数に数えず、上限の枠を食わない", async () => {
    quiet();
    const embed = vi.fn(async (id: string) => (id.startsWith("e") ? 0 : 1));
    const n = await runEmbeddingBackfill({ ...base, wikiIds: ["e1", "e2", "a", "b", "c"], embed, limit: 2 });
    expect(n).toBe(2);
    expect(embed).toHaveBeenCalledTimes(4);
  });

  it("読み込み上限を超えては読まない", async () => {
    quiet();
    const embed = vi.fn(async () => 0);
    await runEmbeddingBackfill({ ...base, wikiIds: ["a", "b", "c"], embed, loadLimit: 2 });
    expect(embed).toHaveBeenCalledTimes(2);
  });
});

describe("後回しの記録（localStorage）", () => {
  it("書いて読み戻せる。壊れた中身は空として扱う", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
    });
    saveDeferredIds(new Set(["a", "b"]));
    expect([...loadDeferredIds()]).toEqual(["a", "b"]);
    store.set(BACKFILL_DEFERRED_KEY, "{not json");
    expect(loadDeferredIds().size).toBe(0);
    vi.unstubAllGlobals();
  });
});
