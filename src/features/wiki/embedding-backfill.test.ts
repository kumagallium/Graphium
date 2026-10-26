// 埋め込み後追いのテスト（対象の選び方・上限・モデル未設定・失敗で中止・0 セクションを数えない）
import { describe, expect, it, vi } from "vitest";

vi.mock("../settings/store", () => ({ getEmbeddingModel: () => "", getSelectedModel: () => "" }));
vi.mock("../../lib/embedding-store", () => ({ embeddingStore: { listDocumentIds: async () => new Set<string>() } }));
vi.mock("../../lib/sidecar", () => ({ getSidecarState: () => ({ status: "ready" }), subscribeSidecarState: () => () => {} }));

import { runEmbeddingBackfill, selectBackfillTargets } from "./embedding-backfill";

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
});

describe("runEmbeddingBackfill", () => {
  const base = { hasEmbeddingModel: () => true, loadDoc: async () => doc, listEmbeddedIds: async () => new Set<string>() };

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

  it("1 件失敗したら残りは中止する", async () => {
    quiet();
    const order: string[] = [];
    const embed = vi.fn(async (id: string) => {
      order.push(id);
      if (id === "b") throw new Error("x");
      return 1;
    });
    const n = await runEmbeddingBackfill({ ...base, wikiIds: ["a", "b", "c"], embed });
    expect(order).toEqual(["a", "b"]);
    expect(n).toBe(1);
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
