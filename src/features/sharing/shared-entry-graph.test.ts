// buildSharedEntryGraph のテスト。
// 守りたいこと:
//   1. 隣接が無ければ中心 1 つだけ（neighborCount 0 = 図を出さない合図）
//   2. 引用 / 派生版 / テンプレート由来 は shared ノード + 隣接→中心の破線エッジ
//   3. 来ている提案は封筒から拾って proposal ノードになる
//   4. 同じ id が複数の群に出ても、ノードもエッジも 1 本だけ（辺の id 衝突を避ける）
//   5. 中心ノードは isCurrent かつ sharedKind なし（押しても何も起きない見た目）

import { describe, it, expect } from "vitest";
import { buildSharedEntryGraph } from "./shared-entry-graph";
import type { SharedEntry } from "../../lib/storage/shared";
import type { SharedReverseLinks } from "./shared-projection";
import type { AuthorIdentity } from "../document-provenance/types";

const author: AuthorIdentity = { name: "Ada", email: "a@b.co" };
const CENTER_ID = "note-1";

function makeEntry(overrides: Partial<SharedEntry>): SharedEntry {
  return {
    id: "id",
    type: "note",
    author,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    hash: "hash",
    prov: { derived_from: [] },
    ...overrides,
  } as SharedEntry;
}

function links(overrides: Partial<SharedReverseLinks> = {}): SharedReverseLinks {
  return { cites: [], forks: [], templates: [], ...overrides };
}

describe("buildSharedEntryGraph", () => {
  it("隣接が無ければ中心ノードだけを返す", () => {
    const result = buildSharedEntryGraph({
      entryId: CENTER_ID,
      entryTitle: "焼結実験",
      entries: [],
    });
    expect(result.nodes).toEqual([
      { id: `shared:${CENTER_ID}`, title: "焼結実験", isCurrent: true, hop: 0 },
    ]);
    expect(result.edges).toEqual([]);
    expect(result.neighborCount).toBe(0);
  });

  it("id が空なら何も作らない", () => {
    const result = buildSharedEntryGraph({ entryId: "", entryTitle: "x", entries: [] });
    expect(result.nodes).toEqual([]);
    expect(result.neighborCount).toBe(0);
  });

  it("派生版は shared ノードと 派生版→中心 の破線エッジになる", () => {
    const entries = [
      makeEntry({ id: "fork-1", extra: { title: "第2回" } }),
      makeEntry({ id: "fork-2", extra: { title: "第3回" } }),
    ];
    const result = buildSharedEntryGraph({
      entryId: CENTER_ID,
      entryTitle: "焼結実験",
      links: links({ forks: ["fork-1", "fork-2"] }),
      entries,
    });

    expect(result.neighborCount).toBe(2);
    expect(result.nodes.slice(1)).toEqual([
      { id: "shared:fork-1", title: "第2回", isCurrent: false, hop: 1, sharedKind: "shared" },
      { id: "shared:fork-2", title: "第3回", isCurrent: false, hop: 1, sharedKind: "shared" },
    ]);
    expect(result.edges).toEqual([
      { source: "shared:fork-1", target: `shared:${CENTER_ID}`, relation: "derived", dashed: true },
      { source: "shared:fork-2", target: `shared:${CENTER_ID}`, relation: "derived", dashed: true },
    ]);
  });

  it("引用は reference、テンプレート由来は derived の破線エッジになる", () => {
    const result = buildSharedEntryGraph({
      entryId: CENTER_ID,
      entryTitle: "焼結実験",
      links: links({ cites: ["cite-1"], templates: ["tpl-1"] }),
      entries: [
        makeEntry({ id: "cite-1", extra: { title: "比較メモ" } }),
        makeEntry({ id: "tpl-1", extra: { title: "テンプレから作った記録" } }),
      ],
    });

    expect(result.edges).toEqual([
      { source: "shared:cite-1", target: `shared:${CENTER_ID}`, relation: "reference", dashed: true },
      { source: "shared:tpl-1", target: `shared:${CENTER_ID}`, relation: "derived", dashed: true },
    ]);
  });

  it("来ている提案は封筒から拾って proposal ノードになる", () => {
    const entries = [
      makeEntry({
        id: "prop-1",
        type: "proposal",
        extra: { title: "昇温速度の追記", target: CENTER_ID, targetHash: "hash" },
      }),
      // 別のエントリへの提案は拾わない
      makeEntry({
        id: "prop-other",
        type: "proposal",
        extra: { title: "他所への提案", target: "note-9", targetHash: "hash" },
      }),
    ];
    const result = buildSharedEntryGraph({
      entryId: CENTER_ID,
      entryTitle: "焼結実験",
      entries,
    });

    expect(result.nodes.slice(1)).toEqual([
      {
        id: "proposal:prop-1",
        title: "昇温速度の追記",
        isCurrent: false,
        hop: 1,
        sharedKind: "proposal",
      },
    ]);
    expect(result.edges).toEqual([
      { source: "proposal:prop-1", target: `shared:${CENTER_ID}`, relation: "derived", dashed: true },
    ]);
  });

  it("同じ id が引用と派生の両方に出ても、ノードもエッジも 1 本だけ", () => {
    const result = buildSharedEntryGraph({
      entryId: CENTER_ID,
      entryTitle: "焼結実験",
      links: links({ cites: ["both-1"], forks: ["both-1"] }),
      entries: [makeEntry({ id: "both-1", extra: { title: "両方" } })],
    });

    expect(result.neighborCount).toBe(1);
    expect(result.edges).toHaveLength(1);
    // 先に来た群（引用）の関係が残る
    expect(result.edges[0]?.relation).toBe("reference");
  });

  it("自分自身は隣接に置かない", () => {
    const result = buildSharedEntryGraph({
      entryId: CENTER_ID,
      entryTitle: "焼結実験",
      links: links({ cites: [CENTER_ID] }),
      entries: [],
    });
    expect(result.neighborCount).toBe(0);
  });

  it("題名は titleOf を優先し、無ければ封筒の extra.title、それも無ければ id", () => {
    const result = buildSharedEntryGraph({
      entryId: CENTER_ID,
      entryTitle: "焼結実験",
      links: links({ forks: ["fork-1", "fork-2", "fork-3"] }),
      entries: [
        makeEntry({ id: "fork-1", extra: { title: "封筒の題名" } }),
        makeEntry({ id: "fork-2", extra: { title: "使われない" } }),
        makeEntry({ id: "fork-3" }),
      ],
      titleOf: (id) => (id === "fork-2" ? "解決した題名" : null),
    });

    expect(result.nodes.slice(1).map((n) => n.title)).toEqual([
      "封筒の題名",
      "解決した題名",
      "fork-3",
    ]);
  });
});
