// 近傍グラフに足すメモの引用（buildMemoQuoteGraph / mergeMemoQuoteGraph）のテスト。
//
// 対象の不変条件:
// - ノードは既存の memo:<captureId>（external: "memo"）。線は memo → いまのノート（used）
// - 本文にブロックが無い紐づけ・ゴミ箱／完全削除のメモは出さない。アーカイブしたメモは出す
// - 題はメモ本文の先頭 1 行を 40 字（buildMemoPeekEntry と同じ）
// - 同じメモを複数ブロックで引用しても 1 ノード
// - 合成は既存の memo: ノードを増やさず、仮の題 "Memo" だけ置き換える。足すものが無ければ同じ参照を返す

import { describe, it, expect } from "vitest";
import { buildMemoQuoteGraph, mergeMemoQuoteGraph, memoNodeId } from "./memo-quote-graph";
import { buildMemoQuoteRef } from "./memo-quote";
import type { CaptureEntry, CaptureIndex } from "../mobile-capture/capture-store";
import type { NoteGraphData } from "../network-graph/graph-builder";

const cap = (id: string, text: string, over: Partial<CaptureEntry> = {}): CaptureEntry => ({
  id,
  text,
  createdAt: "2026-10-30T10:00:00.000Z",
  ...over,
});
const index = (...captures: CaptureEntry[]): CaptureIndex => ({
  version: 1,
  updatedAt: "2026-10-30T00:00:00.000Z",
  captures,
});

describe("buildMemoQuoteGraph", () => {
  it("メモのノードと、メモ → ノートの used の線を作る", () => {
    const g = buildMemoQuoteGraph(
      {
        memoQuotes: { b1: buildMemoQuoteRef(cap("c1", "x")) },
        liveBlockIds: new Set(["b1"]),
        captureIndex: index(cap("c1", "粒界に析出物\n二行目")),
      },
      "note-1",
    );
    expect(g.nodes).toEqual([
      { id: "memo:c1", title: "粒界に析出物", isCurrent: false, hop: 1, external: "memo" },
    ]);
    expect(g.edges).toEqual([{ source: "memo:c1", target: "note-1", relation: "used" }]);
    expect(memoNodeId("c1")).toBe("memo:c1");
  });

  it("題は先頭の空行を飛ばして 40 字まで", () => {
    const g = buildMemoQuoteGraph(
      {
        memoQuotes: { b1: buildMemoQuoteRef(cap("c1", "x")) },
        liveBlockIds: new Set(["b1"]),
        captureIndex: index(cap("c1", `\n\n${"あ".repeat(50)}`)),
      },
      "n",
    );
    expect(g.nodes[0].title).toBe("あ".repeat(40));
  });

  it("本文にブロックが無い紐づけ・ゴミ箱／完全削除のメモは出さない。アーカイブは出す", () => {
    const g = buildMemoQuoteGraph(
      {
        memoQuotes: {
          gone: buildMemoQuoteRef(cap("a", "x")),
          trashed: buildMemoQuoteRef(cap("b", "x")),
          missing: buildMemoQuoteRef(cap("c", "x")),
          archived: buildMemoQuoteRef(cap("d", "x")),
        },
        liveBlockIds: new Set(["trashed", "missing", "archived"]),
        captureIndex: index(
          cap("a", "本文に無いブロック"),
          cap("b", "ゴミ箱", { deletedAt: "2026-10-31T00:00:00.000Z" }),
          cap("d", "アーカイブ", { archivedAt: "2026-10-31T00:00:00.000Z" }),
        ),
      },
      "n",
    );
    expect(g.nodes.map((n) => n.id)).toEqual(["memo:d"]);
  });

  it("同じメモを複数のブロックで引用しても 1 ノード・1 本", () => {
    const ref = buildMemoQuoteRef(cap("c1", "x"));
    const g = buildMemoQuoteGraph(
      {
        memoQuotes: new Map([["b1", ref], ["b2", ref]]),
        liveBlockIds: new Set(["b1", "b2"]),
        captureIndex: index(cap("c1", "x")),
      },
      "n",
    );
    expect(g.nodes).toHaveLength(1);
    expect(g.edges).toHaveLength(1);
  });

  it("紐づけ・メモ一覧が無ければ空", () => {
    const empty = { nodes: [], edges: [] };
    expect(buildMemoQuoteGraph({ memoQuotes: undefined, liveBlockIds: new Set(), captureIndex: null }, "n")).toEqual(empty);
    expect(
      buildMemoQuoteGraph({ memoQuotes: { b1: buildMemoQuoteRef(cap("c1", "x")) }, liveBlockIds: new Set(["b1"]), captureIndex: null }, "n"),
    ).toEqual(empty);
  });
});

describe("mergeMemoQuoteGraph", () => {
  const base: NoteGraphData = {
    nodes: [{ id: "n", title: "ノート", isCurrent: true, hop: 0 }],
    edges: [],
  };
  const extra = (title = "メモの題"): NoteGraphData => ({
    nodes: [{ id: "memo:c1", title, isCurrent: false, hop: 1, external: "memo" }],
    edges: [{ source: "memo:c1", target: "n", relation: "used" }],
  });

  it("ノードと線を足す", () => {
    const merged = mergeMemoQuoteGraph(base, extra());
    expect(merged.nodes.map((n) => n.id)).toEqual(["n", "memo:c1"]);
    expect(merged.edges).toHaveLength(1);
  });

  it("足すものが無ければ同じ参照を返す", () => {
    expect(mergeMemoQuoteGraph(base, { nodes: [], edges: [] })).toBe(base);
  });

  it("既に同じ memo: ノードと線があれば増やさず、仮の題 Memo だけ置き換える（同じ内容なら参照も保つ）", () => {
    const withMemo: NoteGraphData = {
      nodes: [...base.nodes, { id: "memo:c1", title: "Memo", isCurrent: false, hop: 1, external: "memo" }],
      edges: [{ source: "n", target: "memo:c1", relation: "derived" }],
    };
    const merged = mergeMemoQuoteGraph(withMemo, extra());
    expect(merged.nodes).toHaveLength(2);
    expect(merged.nodes[1].title).toBe("メモの題");
    // 向きが逆でも同じ 2 点の線は畳む
    expect(merged.edges).toHaveLength(1);

    const named: NoteGraphData = {
      nodes: [...base.nodes, { id: "memo:c1", title: "もう題がある", isCurrent: false, hop: 1, external: "memo" }],
      edges: [{ source: "n", target: "memo:c1", relation: "derived" }],
    };
    expect(mergeMemoQuoteGraph(named, extra())).toBe(named);
  });
});

// ── 付いたメモ（細く薄い実線）と「メモ n 件」のまとめ ──
import type { MediaIndexEntry } from "../asset-browser/media-index";
import { assetFileIdOfNode, memoGroupNodeId } from "./memo-quote-graph";

const asset = (fileId: string, name = "素材.pdf"): MediaIndexEntry =>
  ({ fileId, name, type: "pdf", mimeType: "application/pdf", url: "", usedIn: [] }) as unknown as MediaIndexEntry;
const onNote = (id: string, fileId = "note-1", over: Partial<CaptureEntry> = {}): CaptureEntry =>
  cap(id, `メモ ${id}`, { sourceNote: { fileId, title: "t" } as CaptureEntry["sourceNote"], ...over });
const onAsset = (id: string, fileId: string, over: Partial<CaptureEntry> = {}): CaptureEntry =>
  cap(id, `素材メモ ${id}`, { sourceAsset: { fileId, name: "素材.pdf", type: "pdf" } as CaptureEntry["sourceAsset"], ...over });

describe("buildMemoQuoteGraph（付いたメモ）", () => {
  const base = { memoQuotes: undefined, liveBlockIds: new Set<string>() };

  it("ノートに付けたメモは細く薄い実線（weak）でノートへ。wiki: 接頭辞は無視して比べる", () => {
    const g = buildMemoQuoteGraph(
      { ...base, captureIndex: index(onNote("a"), onNote("b", "wiki:note-1"), onNote("c", "other")), noteFileId: "note-1" },
      "note-1",
    );
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["memo:a", "memo:b"]);
    expect(g.edges.every((e) => e.weak === true && e.target === "note-1")).toBe(true);
  });

  it("引用済みのメモがブロックにも付いていてもノード 1 つ・ノートへは実線だけ", () => {
    const quoted = onNote("q");
    const g = buildMemoQuoteGraph(
      {
        memoQuotes: { b1: buildMemoQuoteRef(quoted) },
        liveBlockIds: new Set(["b1"]),
        captureIndex: index(quoted),
        noteFileId: "note-1",
      },
      "note-1",
    );
    expect(g.nodes).toHaveLength(1);
    expect(g.edges).toEqual([{ source: "memo:q", target: "note-1", relation: "used" }]);
  });

  it("素材ノードに付いたメモは素材へ細く薄い実線。素材とノートの両方に付くメモは 1 ノード・線は相手ごとに 1 本", () => {
    const both = onNote("x", "note-1", { sourceAsset: { fileId: "f1", name: "素材.pdf", type: "pdf" } as CaptureEntry["sourceAsset"] });
    const g = buildMemoQuoteGraph(
      {
        ...base,
        captureIndex: index(both, onAsset("y", "f1")),
        noteFileId: "note-1",
        assetNodes: [{ nodeId: "pdf:f1", entry: asset("f1") }],
      },
      "note-1",
    );
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["memo:x", "memo:y"]);
    expect(g.edges.map((e) => `${e.source}>${e.target}`).sort()).toEqual([
      "memo:x>note-1",
      "memo:x>pdf:f1",
      "memo:y>pdf:f1",
    ]);
    expect(g.edges.every((e) => e.weak)).toBe(true);
  });

  it("アーカイブ・ゴミ箱のメモは付いたメモとして出さない", () => {
    const g = buildMemoQuoteGraph(
      {
        ...base,
        captureIndex: index(
          onNote("a", "note-1", { archivedAt: "2026-10-31T00:00:00.000Z" }),
          onAsset("b", "f1", { deletedAt: "2026-10-31T00:00:00.000Z" }),
        ),
        noteFileId: "note-1",
        assetNodes: [{ nodeId: "pdf:f1", entry: asset("f1") }],
      },
      "note-1",
    );
    expect(g).toEqual({ nodes: [], edges: [] });
  });

  it("5 件までは個別、6 件でまとめる（まとめの ID は memos:<相手>、線は細く薄い実線）。引用の実線は個別のまま", () => {
    const five = ["a", "b", "c", "d", "e"].map((i) => onNote(i));
    const g5 = buildMemoQuoteGraph({ ...base, captureIndex: index(...five), noteFileId: "note-1" }, "note-1");
    expect(g5.nodes).toHaveLength(5);

    const quoted = onNote("q");
    const six = ["a", "b", "c", "d", "e", "f"].map((i) => onNote(i));
    const g6 = buildMemoQuoteGraph(
      {
        memoQuotes: { b1: buildMemoQuoteRef(quoted) },
        liveBlockIds: new Set(["b1"]),
        captureIndex: index(quoted, ...six),
        noteFileId: "note-1",
        groupLabel: (n) => `メモ ${n} 件`,
      },
      "note-1",
    );
    // 引用の q は個別、付けた 6 件（q は除く）は 1 ノード
    expect(g6.nodes.map((n) => n.id).sort()).toEqual(["memo:q", "memos:note-1"]);
    expect(g6.nodes.find((n) => n.id === "memos:note-1")?.title).toBe("メモ 6 件");
    expect(g6.edges).toContainEqual({ source: "memos:note-1", target: "note-1", relation: "used", weak: true });
    expect(memoGroupNodeId("pdf:f1")).toBe("memos:pdf:f1");
  });

  it("素材側も 5 件超でまとめる", () => {
    const memos = ["a", "b", "c", "d", "e", "f"].map((i) => onAsset(i, "f1"));
    const g = buildMemoQuoteGraph(
      { ...base, captureIndex: index(...memos), assetNodes: [{ nodeId: "pdf:f1", entry: asset("f1") }] },
      "note-1",
    );
    expect(g.nodes.map((n) => n.id)).toEqual(["memos:pdf:f1"]);
    expect(g.edges[0]).toMatchObject({ target: "pdf:f1", weak: true });
  });

  it("noteFileId・素材が無ければ従来どおり（付けたメモの線は出ない）", () => {
    const g = buildMemoQuoteGraph({ ...base, captureIndex: index(onNote("a")) }, "note-1");
    expect(g).toEqual({ nodes: [], edges: [] });
  });
});

describe("assetFileIdOfNode", () => {
  it("素材ノードの fileId を返す", () => {
    expect(assetFileIdOfNode("media:m1")).toBe("m1");
    expect(assetFileIdOfNode("pdf:p1")).toBe("p1");
    expect(assetFileIdOfNode("data:d1")).toBe("d1");
    expect(assetFileIdOfNode("document:d1")).toBe("d1");
    expect(assetFileIdOfNode("url:https://x.test/")).toBe("url:https://x.test/");
    expect(assetFileIdOfNode("note-1")).toBeNull();
    expect(assetFileIdOfNode("memo:c1")).toBeNull();
    expect(assetFileIdOfNode("chat:c1")).toBeNull();
  });
});
