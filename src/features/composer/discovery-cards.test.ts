// 発見カード生成ロジックのテスト
// - ベースカード（現ノート起点）
// - wikiLog 由来（直近 7 日）
// - 直近更新ノート（埋め）
// - 最大 4 枚

import { describe, it, expect } from "vitest";
import { buildDiscoveryCards, promptForDiscoveryCard } from "./discovery-cards";
import type { GraphiumIndex, NoteIndexEntry } from "../navigation/index-file";
import type { WikiLogEntry } from "../wiki/wiki-log";

const NOW = new Date("2026-04-25T10:00:00Z");

function entry(partial: Partial<NoteIndexEntry> & { noteId: string; title: string; modifiedAt: string }): NoteIndexEntry {
  return {
    noteId: partial.noteId,
    title: partial.title,
    modifiedAt: partial.modifiedAt,
    createdAt: partial.modifiedAt,
    headings: [],
    labels: [],
    outgoingLinks: [],
    source: partial.source,
    wikiKind: partial.wikiKind,
    author: partial.author,
    model: partial.model,
  };
}

function logEntry(partial: Partial<WikiLogEntry> & { id: string; type: WikiLogEntry["type"]; timestamp: string }): WikiLogEntry {
  return {
    id: partial.id,
    timestamp: partial.timestamp,
    type: partial.type,
    wikiIds: partial.wikiIds ?? ["wiki-default"],
    summary: partial.summary ?? "summary",
    detail: partial.detail,
  };
}

describe("buildDiscoveryCards", () => {
  it("文脈が空のとき空配列を返す", () => {
    const cards = buildDiscoveryCards({
      noteIndex: null,
      activeFileId: null,
      wikiLogEntries: [],
      now: NOW,
    });
    expect(cards).toEqual([]);
  });

  it("人間ノートを開いていれば「要約」ベースカードが先頭に来る", () => {
    const idx: GraphiumIndex = {
      version: 6,
      updatedAt: NOW.toISOString(),
      notes: [entry({ noteId: "note-A", title: "S-A anneal", modifiedAt: NOW.toISOString(), source: "human" })],
    };
    const cards = buildDiscoveryCards({
      noteIndex: idx,
      activeFileId: "note-A",
      wikiLogEntries: [],
      now: NOW,
    });
    expect(cards[0]?.title).toBe("このノートを要約する");
    expect(cards[0]?.action.kind).toBe("summarize-note");
  });

  it("Wiki ドキュメントを開いていれば「整理」カードが出る", () => {
    const idx: GraphiumIndex = {
      version: 6,
      updatedAt: NOW.toISOString(),
      notes: [entry({ noteId: "wiki-A", title: "Summary of S-A", modifiedAt: NOW.toISOString(), source: "ai", wikiKind: "summary" })],
    };
    const cards = buildDiscoveryCards({
      noteIndex: idx,
      activeFileId: "wiki-A",
      wikiLogEntries: [],
      now: NOW,
    });
    expect(cards[0]?.title).toBe("この Wiki を整理する");
  });

  it("直近 7 日の wikiLog からイベントごとに、wiki タイトル付きでカード化（lint と delete は無視）", () => {
    const recent = (offsetHours: number) => new Date(NOW.getTime() - offsetHours * 3600 * 1000).toISOString();
    const idx: GraphiumIndex = {
      version: 6,
      updatedAt: NOW.toISOString(),
      notes: [
        entry({ noteId: "wiki-1", title: "XRD 測定手順", modifiedAt: NOW.toISOString(), source: "ai", wikiKind: "summary" }),
        entry({ noteId: "wiki-2", title: "T_cal", modifiedAt: NOW.toISOString(), source: "ai", wikiKind: "concept" }),
        entry({ noteId: "wiki-3", title: "Cu S-A 要約", modifiedAt: NOW.toISOString(), source: "ai", wikiKind: "summary" }),
        entry({ noteId: "wiki-4", title: "S-A + S-B 統合", modifiedAt: NOW.toISOString(), source: "ai", wikiKind: "synthesis" }),
      ],
    };
    const cards = buildDiscoveryCards({
      noteIndex: idx,
      activeFileId: null,
      wikiLogEntries: [
        logEntry({ id: "1", type: "ingest", timestamp: recent(2), wikiIds: ["wiki-1"] }),
        logEntry({ id: "2", type: "cross-update", timestamp: recent(5), wikiIds: ["wiki-2"] }),
        logEntry({ id: "3", type: "regenerate", timestamp: recent(10), wikiIds: ["wiki-3"] }),
        logEntry({ id: "4", type: "merge", timestamp: recent(20), wikiIds: ["wiki-4"] }),
        logEntry({ id: "5", type: "lint", timestamp: recent(1), wikiIds: ["wiki-1"] }),
        logEntry({ id: "6", type: "delete", timestamp: recent(1), wikiIds: ["wiki-2"] }),
      ],
      now: NOW,
    });
    expect(cards).toHaveLength(4);
    expect(cards.map((c) => c.title)).toEqual([
      "「XRD 測定手順」について教えて",
      "「T_cal」について教えて",
      "「Cu S-A 要約」について教えて",
      "「S-A + S-B 統合」について教えて",
    ]);
    // hint で type を区別
    expect(cards.map((c) => c.hint)).toEqual([
      "最近作られた Wiki",
      "他ノートとの横断更新の提案",
      "別モデルでの再生成結果",
      "複数ノートを統合した Synthesis",
    ]);
  });

  it("noteIndex に存在しない wiki のログは捨てる（タイトル不明な古ログ）", () => {
    const recent = new Date(NOW.getTime() - 3600 * 1000).toISOString();
    const cards = buildDiscoveryCards({
      noteIndex: { version: 6, updatedAt: NOW.toISOString(), notes: [] },
      activeFileId: null,
      wikiLogEntries: [logEntry({ id: "1", type: "ingest", timestamp: recent, wikiIds: ["wiki-ghost"] })],
      now: NOW,
    });
    expect(cards).toEqual([]);
  });

  it("7 日より古い wikiLog エントリは無視される", () => {
    const oldIso = new Date(NOW.getTime() - 8 * 24 * 3600 * 1000).toISOString();
    const idx: GraphiumIndex = {
      version: 6,
      updatedAt: NOW.toISOString(),
      notes: [entry({ noteId: "wiki-old", title: "old", modifiedAt: NOW.toISOString(), source: "ai", wikiKind: "summary" })],
    };
    const cards = buildDiscoveryCards({
      noteIndex: idx,
      activeFileId: null,
      wikiLogEntries: [logEntry({ id: "old", type: "ingest", timestamp: oldIso, wikiIds: ["wiki-old"] })],
      now: NOW,
    });
    expect(cards).toEqual([]);
  });

  it("同じ wikiId のログは最初の 1 つだけ採用される（重複排除）", () => {
    const recent = new Date(NOW.getTime() - 3600 * 1000).toISOString();
    const idx: GraphiumIndex = {
      version: 6,
      updatedAt: NOW.toISOString(),
      notes: [entry({ noteId: "wiki-1", title: "Test Wiki", modifiedAt: NOW.toISOString(), source: "ai", wikiKind: "summary" })],
    };
    const cards = buildDiscoveryCards({
      noteIndex: idx,
      activeFileId: null,
      wikiLogEntries: [
        logEntry({ id: "1", type: "ingest", timestamp: recent, wikiIds: ["wiki-1"] }),
        logEntry({ id: "2", type: "regenerate", timestamp: recent, wikiIds: ["wiki-1"] }),
      ],
      now: NOW,
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].title).toBe("「Test Wiki」について教えて");
  });

  it('activeFileId に "wiki:" プレフィックスが付いていても Wiki ベースカードを返す', () => {
    const idx: GraphiumIndex = {
      version: 6,
      updatedAt: NOW.toISOString(),
      notes: [entry({ noteId: "abc-123", title: "Summary doc", modifiedAt: NOW.toISOString(), source: "ai", wikiKind: "summary" })],
    };
    const cards = buildDiscoveryCards({
      noteIndex: idx,
      activeFileId: "wiki:abc-123",
      wikiLogEntries: [],
      now: NOW,
    });
    expect(cards[0]?.title).toBe("この Wiki を整理する");
  });

  it("ベース + ログで枠が余るときは直近更新ノートで埋める（自ノートと AI/skill ノートは除外）", () => {
    const idx: GraphiumIndex = {
      version: 6,
      updatedAt: NOW.toISOString(),
      notes: [
        entry({ noteId: "note-A", title: "active", modifiedAt: NOW.toISOString(), source: "human" }),
        entry({ noteId: "note-B", title: "recent human", modifiedAt: new Date(NOW.getTime() - 3600000).toISOString(), source: "human" }),
        entry({ noteId: "wiki-1", title: "wiki", modifiedAt: NOW.toISOString(), source: "ai", wikiKind: "summary" }),
        entry({ noteId: "skill-1", title: "skill", modifiedAt: NOW.toISOString(), source: "skill" }),
        entry({ noteId: "note-C", title: "older human", modifiedAt: new Date(NOW.getTime() - 7200000).toISOString(), source: "human" }),
      ],
    };
    const cards = buildDiscoveryCards({
      noteIndex: idx,
      activeFileId: "note-A",
      wikiLogEntries: [],
      now: NOW,
    });
    // [base for note-A, note-B, note-C] = 3 枚
    expect(cards).toHaveLength(3);
    expect(cards[0].id).toContain("note-A");
    expect(cards[1].title).toBe("「recent human」について教えて");
    expect(cards[2].title).toBe("「older human」について教えて");
  });

  it("最大 4 枚まで切り詰める", () => {
    const recent = (offset: number) => new Date(NOW.getTime() - offset * 3600 * 1000).toISOString();
    const idx: GraphiumIndex = {
      version: 6,
      updatedAt: NOW.toISOString(),
      notes: [
        entry({ noteId: "note-A", title: "active", modifiedAt: NOW.toISOString(), source: "human" }),
        entry({ noteId: "wiki-1", title: "w1", modifiedAt: NOW.toISOString(), source: "ai", wikiKind: "summary" }),
        entry({ noteId: "wiki-2", title: "w2", modifiedAt: NOW.toISOString(), source: "ai", wikiKind: "summary" }),
        entry({ noteId: "wiki-3", title: "w3", modifiedAt: NOW.toISOString(), source: "ai", wikiKind: "summary" }),
        entry({ noteId: "wiki-4", title: "w4", modifiedAt: NOW.toISOString(), source: "ai", wikiKind: "summary" }),
      ],
    };
    const cards = buildDiscoveryCards({
      noteIndex: idx,
      activeFileId: "note-A",
      wikiLogEntries: [
        logEntry({ id: "1", type: "ingest", timestamp: recent(1), wikiIds: ["wiki-1"] }),
        logEntry({ id: "2", type: "cross-update", timestamp: recent(2), wikiIds: ["wiki-2"] }),
        logEntry({ id: "3", type: "regenerate", timestamp: recent(3), wikiIds: ["wiki-3"] }),
        logEntry({ id: "4", type: "merge", timestamp: recent(4), wikiIds: ["wiki-4"] }),
      ],
      now: NOW,
    });
    expect(cards).toHaveLength(4);
    // 1 枚目は base、残り 3 枚は wikiLog
    expect(cards[0].id).toContain("note-A");
    expect(cards.slice(1).every((c) => c.id.startsWith("log-"))).toBe(true);
  });
});

describe("promptForDiscoveryCard", () => {
  it("kind ごとに適切なプロンプトを返す", () => {
    expect(promptForDiscoveryCard({ id: "x", title: "t", action: { kind: "summarize-note" } })).toContain("3 行");
    expect(promptForDiscoveryCard({ id: "x", title: "t", action: { kind: "continue-writing" } })).toContain("続き");
    expect(promptForDiscoveryCard({ id: "x", title: "t", action: { kind: "visualize-prov" } })).toContain("PROV");
    expect(promptForDiscoveryCard({ id: "x", title: "t", action: { kind: "make-concept-wiki" } })).toContain("Concept");
  });

  it("custom action は key で分岐", () => {
    expect(promptForDiscoveryCard({ id: "x", title: "t", action: { kind: "custom", key: "clarify-wiki" } })).toContain("矛盾");
    expect(promptForDiscoveryCard({ id: "x", title: "「ノート1」について教えて", action: { kind: "custom", key: "note:abc" } })).toBe("「ノート1」について教えてください。");
    expect(promptForDiscoveryCard({ id: "x", title: "「Wiki1」について教えて", action: { kind: "custom", key: "wiki:xyz" } })).toBe("「Wiki1」について教えてください。");
  });
});
