// 来歴の本体（lineage.ts）を、本体を持たない読み手（索引だけ）で辿ったときの回帰テスト。
// チャットの読み口はアプリで開いたノートの本体しか持たないため、開いていないノートの
// noteLinks・provLinks・derivedFromNoteId は索引（v33）の写しから読む。
// つながり・上流・下流に出るノートが、本体ありのときと同じになることを確かめる。

import { describe, expect, it } from "vitest";
import { buildIndexEntry, type NoteIndexEntry } from "../navigation/index-file";
import type { GraphiumDocument } from "../../lib/document-types";
import { connectionsOf, downstreamOf, traceLineage, upstreamOf, type LineageNode } from "./lineage";
import type { ProvGraphReader } from "./reader";

const plain = (title: string, extra: Partial<GraphiumDocument> = {}, provLinks: unknown[] = []) =>
  ({ title, pages: [{ blocks: [], provLinks }], ...extra }) as unknown as GraphiumDocument;
const noteLink = (targetNoteId: string, sourceBlockId = "b1") => ({
  targetNoteId,
  sourceBlockId,
  type: "derived_from" as const,
});
const provLink = (targetNoteId: string, type: string, targetBlockId = "t1") => ({
  id: `l-${targetNoteId}`,
  sourceBlockId: "s1",
  targetBlockId,
  targetNoteId,
  type,
  layer: "prov",
  createdBy: "human",
});

// 実データの形を小さく写したもの
// - meeting（打ち合わせ）は noteLinks で 3 本のノートを @ で引き（つながり）、
//   follow は meeting を @ で引いている（相手側から来るつながり）
// - eln（ELN の基準）は alcoa を @ で 1 本引くだけ
// - kid は meeting から「派生」で作った（meeting の noteLinks にも入る）
// - kid は sample を provLinks（used）で使い、sample は raw から派生した
const docs: Record<string, GraphiumDocument> = {
  meeting: plain("20261019 の打ち合わせ", { noteLinks: [noteLink("a"), noteLink("b"), noteLink("c"), noteLink("kid")] }),
  a: plain("論点 A"),
  b: plain("論点 B"),
  c: plain("論点 C"),
  follow: plain("次の回", { noteLinks: [noteLink("meeting")] }),
  eln: plain("ELN の基準", { noteLinks: [noteLink("alcoa")] }),
  alcoa: plain("ALCOA"),
  kid: plain("試作", { derivedFromNoteId: "meeting" }, [provLink("sample", "used")]),
  sample: plain("試料", { derivedFromNoteId: "raw" }),
  raw: plain("原料", { noteLinks: [noteLink("sample")] }),
};
const entries: NoteIndexEntry[] = Object.entries(docs).map(([id, d]) => buildIndexEntry(id, d));

const reader = (withBody: boolean): ProvGraphReader => ({
  entries: () => entries,
  readNote: (id) => (withBody ? (docs[id] ?? null) : null),
  sourceTitle: (id) => entries.find((e) => e.noteId === id)?.title ?? id,
});
const full = reader(true);
const indexOnly = reader(false);

// 同じ相手への線が複数あっても（noteLinks と逆引き）walk が 1 件にまとめるので、ID の集合で比べる
const ids = (edges: { noteId: string }[]) => Array.from(new Set(edges.map((e) => e.noteId))).sort();
const shape = (nodes: LineageNode[]) =>
  nodes.map((n) => `${n.depth}:${n.noteId}:${n.via?.layer}`).sort();

describe("本体を持たない読み手（索引だけ）", () => {
  it("自分の noteLinks から出ているつながりを拾う（打ち合わせの 3 本と、相手から来る 1 本）", () => {
    expect(ids(connectionsOf("meeting", indexOnly))).toEqual(["a", "b", "c", "follow"]);
    expect(ids(connectionsOf("meeting", indexOnly))).toEqual(ids(connectionsOf("meeting", full)));
  });

  it("@ 1 本だけのノートも、両側からつながりとして見える", () => {
    expect(ids(connectionsOf("eln", indexOnly))).toEqual(["alcoa"]);
    expect(ids(connectionsOf("alcoa", indexOnly))).toEqual(["eln"]);
  });

  it("派生の下流は noteLinks の写しと相手の derivedFromNoteId で見分ける", () => {
    expect(ids(downstreamOf("meeting", indexOnly))).toEqual(["kid"]);
    expect(ids(downstreamOf("raw", indexOnly))).toEqual(ids(downstreamOf("raw", full)));
    // provLinks で使われた側からの逆引き（相手の本体が無くても索引の線で引く）
    expect(ids(downstreamOf("sample", indexOnly))).toEqual(["kid"]);
  });

  it("上流は provLinks と derivedFromNoteId の写しから読む", () => {
    expect(ids(upstreamOf("kid", indexOnly))).toEqual(["meeting", "sample"]);
    expect(ids(upstreamOf("kid", indexOnly))).toEqual(ids(upstreamOf("kid", full)));
    expect(upstreamOf("sample", indexOnly).map((e) => [e.noteId, e.type])).toEqual([["raw", "derived_from"]]);
  });

  it("traceLineage の上流・下流・つながりが本体ありのときと同じになる", () => {
    for (const id of Object.keys(docs)) {
      for (const depth of [1, 2, 3]) {
        const a = traceLineage(id, { depth }, indexOnly);
        const b = traceLineage(id, { depth }, full);
        expect({ id, depth, up: shape(a.upstream) }).toEqual({ id, depth, up: shape(b.upstream) });
        expect({ id, depth, down: shape(a.downstream) }).toEqual({ id, depth, down: shape(b.downstream) });
        expect({ id, depth, conn: shape(a.connections) }).toEqual({ id, depth, conn: shape(b.connections) });
      }
    }
  });
});
