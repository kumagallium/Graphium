// buildNoteSharedGraph のテスト。
// 守りたいこと:
//   1. forkedFrom があれば shared ノード + 破線エッジ（ノート→shared）を 1 本作る
//   2. 自分の共有エントリへの提案は proposal ノード + 破線エッジ（proposal→ノート）を作る
//   3. どちらも無ければ空
//   4. shared ノードのタイトルは entries から extra.title を優先し、無ければ authorName
//   5. 提案の対象が自分のエントリでなければ拾わない

import { describe, it, expect } from "vitest";
import { buildNoteSharedGraph } from "./note-shared-graph";
import type { SharedEntry } from "../../lib/storage/shared";
import type { AuthorIdentity } from "../document-provenance/types";

const author: AuthorIdentity = { name: "Ada", email: "a@b.co" };
const NOTE_ID = "note-1";
const ORIGIN_ID = "0197b0a0-0000-7000-8000-000000000001";
const PROPOSAL_ID = "0197b0a0-0000-7000-8000-000000000002";

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
  };
}

describe("buildNoteSharedGraph", () => {
  it("forkedFrom / sharedRef のどちらも無ければ空", () => {
    const result = buildNoteSharedGraph({}, NOTE_ID, []);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("forkedFrom があれば shared ノードとノート→shared の破線エッジを作る", () => {
    const doc = {
      forkedFrom: {
        sharedId: ORIGIN_ID,
        hash: "origin-hash",
        authorName: "Grace",
        authorEmail: "g@b.co",
        forkedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    const entries = [makeEntry({ id: ORIGIN_ID, extra: { title: "元のノート" } })];
    const result = buildNoteSharedGraph(doc, NOTE_ID, entries);

    expect(result.nodes).toEqual([
      {
        id: `shared:${ORIGIN_ID}`,
        title: "元のノート",
        isCurrent: false,
        hop: 1,
        sharedKind: "shared",
      },
    ]);
    expect(result.edges).toEqual([
      { source: NOTE_ID, target: `shared:${ORIGIN_ID}`, relation: "derived", dashed: true },
    ]);
  });

  it("shared ノードのタイトルは entries に extra.title が無ければ authorName にフォールバックする", () => {
    const doc = {
      forkedFrom: {
        sharedId: ORIGIN_ID,
        hash: "origin-hash",
        authorName: "Grace",
        authorEmail: "g@b.co",
        forkedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    const result = buildNoteSharedGraph(doc, NOTE_ID, []);
    expect(result.nodes[0].title).toBe("Grace");
  });

  it("自分の共有エントリへの提案を proposal ノードとして拾い、proposal→ノートの破線エッジを作る", () => {
    const doc = { sharedRef: { id: ORIGIN_ID, type: "note" as const, sharedAt: "2026-01-01T00:00:00.000Z", hash: "h" } };
    const entries = [
      makeEntry({ id: ORIGIN_ID, extra: { title: "元のノート" } }),
      makeEntry({
        id: PROPOSAL_ID,
        type: "proposal",
        extra: { title: "こう変えたい", target: ORIGIN_ID, targetHash: "h", targetTitle: "元のノート" },
      }),
    ];
    const result = buildNoteSharedGraph(doc, NOTE_ID, entries);

    expect(result.nodes).toEqual([
      {
        id: `proposal:${PROPOSAL_ID}`,
        title: "こう変えたい",
        isCurrent: false,
        hop: 1,
        sharedKind: "proposal",
      },
    ]);
    expect(result.edges).toEqual([
      { source: `proposal:${PROPOSAL_ID}`, target: NOTE_ID, relation: "derived", dashed: true },
    ]);
  });

  it("他人のエントリへの提案は拾わない（自分の sharedRef.id と一致するものだけ）", () => {
    const doc = { sharedRef: { id: ORIGIN_ID, type: "note" as const, sharedAt: "2026-01-01T00:00:00.000Z", hash: "h" } };
    const entries = [
      makeEntry({
        id: PROPOSAL_ID,
        type: "proposal",
        extra: { title: "他人宛て", target: "別のエントリ", targetHash: "h", targetTitle: "別のノート" },
      }),
    ];
    const result = buildNoteSharedGraph(doc, NOTE_ID, entries);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("shared と proposal が両方あれば両方を返す", () => {
    const doc = {
      forkedFrom: {
        sharedId: ORIGIN_ID,
        hash: "origin-hash",
        authorName: "Grace",
        authorEmail: "g@b.co",
        forkedAt: "2026-01-01T00:00:00.000Z",
      },
      sharedRef: { id: "my-entry", type: "note" as const, sharedAt: "2026-01-01T00:00:00.000Z", hash: "h" },
    };
    const entries = [
      makeEntry({ id: ORIGIN_ID, extra: { title: "元のノート" } }),
      makeEntry({
        id: PROPOSAL_ID,
        type: "proposal",
        extra: { title: "提案 A", target: "my-entry", targetHash: "h", targetTitle: "自分のノート" },
      }),
    ];
    const result = buildNoteSharedGraph(doc, NOTE_ID, entries);
    expect(result.nodes.map((n) => n.sharedKind).sort()).toEqual(["proposal", "shared"]);
    expect(result.edges).toHaveLength(2);
  });
});
