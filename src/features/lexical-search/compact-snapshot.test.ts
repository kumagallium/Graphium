// 詰めた保存形（compact-snapshot）のテスト
// - 往復しても索引の中身（MiniSearch 標準の toJSON）と検索結果が変わらない
// - discard の残骸・掃除のあと・空の索引でも往復できる
// - 復元後も追加・削除・掃除が動く
// - 壊れた保存形・フィールド構成の違う保存形は例外にする
// - 旧形式（toJSON そのまま）は一度だけ読めて、書き直しの印が付く
//
// MiniSearch の内部構造に頼っているので、minisearch の版を上げたらここが最初に落ちる

import { describe, expect, it } from "vitest";
import MiniSearch from "minisearch";
import { COMPACT_VERSION, fromCompact, termDocumentFrequencies, toCompact } from "./compact-snapshot";
import { LEXICAL_FORMAT_VERSION, LexicalIndex, miniSearchOptions, type LexicalDoc } from "./lexical-index";

function doc(i: number, text: string, title = `資料 ${i % 7}`): LexicalDoc {
  return { id: `note:s${i % 11}:c${i}`, kind: "note", sourceId: `s${i % 11}`, chunkId: `c${i}`, title, text };
}

const SENTENCES = [
  "湿度 60% 以上で試薬 X が劣化する。デシケーター保管が必須。",
  "Bi2Te3 の焼結条件を検討した。thermoelectric figure of merit を測る。",
  "PPMS の thermal transport option で熱伝導率を測定する。",
  "熱電変換材料のゼーベック係数と電気伝導率の関係。",
  "乾燥剤は 2 週間で交換する。サンプルホルダーの取り付け手順。",
  "The Seebeck coefficient decreases as the carrier concentration increases.",
];

function buildIndex(n: number): MiniSearch<LexicalDoc> {
  const ms = new MiniSearch<LexicalDoc>(miniSearchOptions());
  const docs: LexicalDoc[] = [];
  for (let i = 0; i < n; i++) {
    // 題を空にしたり、本文の語を題に入れたりして、語がフィールドに出る順をばらつかせる
    const title = i % 4 === 0 ? "" : i % 4 === 1 ? SENTENCES[(i + 2) % SENTENCES.length] : `資料 ${i % 7}`;
    docs.push(doc(i, `${SENTENCES[i % SENTENCES.length]} 追記 ${i} ${SENTENCES[(i * 5 + 1) % SENTENCES.length]}`, title));
  }
  ms.addAll(docs);
  return ms;
}

const QUERIES = ["劣化", "熱電変換", "seebeck coefficient", "thermo", "デシケーター 保管", "追記 17", "存在しない語"];

function searchAll(ms: MiniSearch<LexicalDoc>) {
  return QUERIES.map((q) => ms.search(q, { prefix: true }).map((r) => ({ id: r.id, score: r.score, terms: r.terms })));
}

/** IndexedDB と同じ構造化複製を通してから復元する */
async function roundTrip(ms: MiniSearch<LexicalDoc>): Promise<MiniSearch<LexicalDoc>> {
  return fromCompact<LexicalDoc>(structuredClone(toCompact(ms)), miniSearchOptions());
}

describe("compact-snapshot", () => {
  it("往復しても索引の中身と検索結果が変わらない", async () => {
    const ms = buildIndex(120);
    const restored = await roundTrip(ms);
    expect(restored.documentCount).toBe(ms.documentCount);
    expect(restored.termCount).toBe(ms.termCount);
    // MiniSearch 標準の保存形が一致する = 索引の中身が同じ
    expect(JSON.parse(JSON.stringify(restored))).toEqual(JSON.parse(JSON.stringify(ms)));
    expect(searchAll(restored)).toEqual(searchAll(ms));
  });

  it("本文に先に出て、あとから題にも出た語でも、題と本文の postings が入れ替わらない", async () => {
    // 語ごとのフィールドの Map は「先に出たフィールド」が先頭になる。
    // 「熱電」は本文（フィールド 1）→ 題（フィールド 0）の順で入る
    const ms = new MiniSearch<LexicalDoc>(miniSearchOptions());
    ms.add(doc(1, "熱電 の 測定", ""));
    ms.add(doc(2, "別の話", "熱電"));
    ms.add(doc(3, "熱電 熱電 熱電", "無関係"));
    const restored = await roundTrip(ms);
    expect(JSON.parse(JSON.stringify(restored))).toEqual(JSON.parse(JSON.stringify(ms)));
    const hits = (m: MiniSearch<LexicalDoc>) => m.search("熱電").map((r) => ({ id: r.id, score: r.score, match: r.match }));
    expect(hits(restored)).toEqual(hits(ms));
    // 題に当たった文書は、題の一致として返る
    expect(restored.search("熱電", { fields: ["title"] }).map((r) => r.id)).toEqual([doc(2, "").id]);
  });

  it("保存形は型付き配列で、postings をプロパティとして持たない", () => {
    const c = toCompact(buildIndex(30));
    expect(c.compactVersion).toBe(COMPACT_VERSION);
    expect(c.postIds).toBeInstanceOf(Uint32Array);
    expect(c.postTfs).toBeInstanceOf(Uint32Array);
    expect(c.postIds.length).toBe(c.postTfs.length);
    expect(c.postIds.length).toBeGreaterThan(0);
    expect(c.ids.length).toBe(30);
  });

  it("discard の残骸が残っていても、掃除したあとでも往復できる", async () => {
    const ms = buildIndex(80);
    for (let i = 0; i < 80; i += 3) ms.discard(doc(i, "").id);
    expect(ms.dirtCount).toBeGreaterThan(0);
    const dirty = await roundTrip(ms);
    expect(dirty.dirtCount).toBe(ms.dirtCount);
    expect(JSON.parse(JSON.stringify(dirty))).toEqual(JSON.parse(JSON.stringify(ms)));
    expect(searchAll(dirty)).toEqual(searchAll(ms));

    await ms.vacuum({ batchSize: Infinity });
    const clean = await roundTrip(ms);
    expect(JSON.parse(JSON.stringify(clean))).toEqual(JSON.parse(JSON.stringify(ms)));
    expect(searchAll(clean)).toEqual(searchAll(ms));
  });

  it("空の索引も往復できる", async () => {
    const ms = new MiniSearch<LexicalDoc>(miniSearchOptions());
    const restored = await roundTrip(ms);
    expect(restored.documentCount).toBe(0);
    expect(restored.search("劣化")).toEqual([]);
    restored.add(doc(1, "湿度で劣化する"));
    expect(restored.search("劣化").map((r) => r.id)).toEqual([doc(1, "").id]);
  });

  it("復元した索引に追加・削除・掃除をしても、作り直した索引と同じ結果になる", async () => {
    const restored = await roundTrip(buildIndex(60));
    const fresh = buildIndex(60);
    for (const ms of [restored, fresh]) {
      ms.add(doc(1000, "新しく足した熱電変換の記録", "追加分"));
      ms.discard(doc(4, "").id);
      ms.discard(doc(9, "").id);
      await ms.vacuum({ batchSize: Infinity });
    }
    expect(JSON.parse(JSON.stringify(restored))).toEqual(JSON.parse(JSON.stringify(fresh)));
    expect(searchAll(restored)).toEqual(searchAll(fresh));
    // 内部 id の採番が続きから始まる（既存の文書と衝突しない）
    expect(restored.has(doc(1000, "").id)).toBe(true);
  });

  it("語ごとの文書数は discard 済みを数えない", () => {
    const ms = new MiniSearch<LexicalDoc>(miniSearchOptions());
    ms.addAll([doc(1, "劣化 する", "a"), doc(2, "劣化 しない", "b"), doc(3, "保管", "c")]);
    const before = new Map(termDocumentFrequencies(ms).map((t) => [t.term, t.df]));
    expect(before.get("劣化")).toBe(2);
    ms.discard(doc(2, "").id);
    const after = new Map(termDocumentFrequencies(ms).map((t) => [t.term, t.df]));
    expect(after.get("劣化")).toBe(1);
    expect(after.get("保管")).toBe(1);
  });

  it("壊れた保存形・フィールド構成の違う保存形は例外にする", async () => {
    const c = toCompact(buildIndex(20));
    await expect(fromCompact(null, miniSearchOptions())).rejects.toThrow();
    await expect(fromCompact({ ...c, compactVersion: COMPACT_VERSION + 1 }, miniSearchOptions())).rejects.toThrow();
    await expect(fromCompact({ ...c, postIds: c.postIds.slice(0, c.postIds.length - 1) }, miniSearchOptions())).rejects.toThrow();
    await expect(fromCompact({ ...c, edgeKeys: c.edgeKeys.slice(0, 3) }, miniSearchOptions())).rejects.toThrow();
    await expect(fromCompact({ ...c, ids: c.ids.slice(1) }, miniSearchOptions())).rejects.toThrow();
    // 件数・採番が文書の一覧と合わない
    await expect(fromCompact({ ...c, documentCount: undefined }, miniSearchOptions())).rejects.toThrow();
    await expect(fromCompact({ ...c, documentCount: c.documentCount + 1 }, miniSearchOptions())).rejects.toThrow();
    await expect(fromCompact({ ...c, nextId: 3 }, miniSearchOptions())).rejects.toThrow();
    await expect(fromCompact({ ...c, shortIds: c.shortIds.map(() => 0) }, miniSearchOptions())).rejects.toThrow();
    await expect(fromCompact({ ...c, averageFieldLength: [Number.NaN, 1] }, miniSearchOptions())).rejects.toThrow();
    // JSON を通すと型付き配列が素のオブジェクトになる → 読めない
    await expect(fromCompact(JSON.parse(JSON.stringify(c)), miniSearchOptions())).rejects.toThrow();
    await expect(fromCompact(c, { ...miniSearchOptions(), fields: ["text", "title"] })).rejects.toThrow();
  });
});

describe("LexicalIndex — 保存形の移行", () => {
  function sample(): LexicalIndex {
    const idx = new LexicalIndex();
    idx.upsertSource({
      kind: "note",
      sourceId: "n1",
      title: "試薬 X の保管",
      fingerprint: "v1",
      chunks: [{ chunkId: "b1", text: "湿度 60% 以上で試薬 X が劣化する。" }],
    });
    return idx;
  }

  it("今の形式は詰めた形で保存し、書き直しの印は付かない", async () => {
    const snap = sample().toSnapshot();
    expect(snap.formatVersion).toBe(LEXICAL_FORMAT_VERSION);
    expect(snap.compact).toBeDefined();
    expect(snap.index).toBeUndefined();
    const restored = await LexicalIndex.fromSnapshot(structuredClone(snap));
    expect(restored!.needsResave).toBe(false);
    expect(restored!.search("劣化")[0]?.chunkId).toBe("b1");
  });

  it("旧形式（形式 1）は読めて、書き直しの印が付く。fingerprint も引き継ぐ", async () => {
    const idx = sample();
    const current = idx.toSnapshot();
    // 形式 1 の保存: MiniSearch 標準の保存形をそのまま持つ
    const ms = new MiniSearch<LexicalDoc>(miniSearchOptions());
    ms.add({ id: "note:n1:b1", kind: "note", sourceId: "n1", chunkId: "b1", title: "試薬 X の保管", text: "湿度 60% 以上で試薬 X が劣化する。" });
    const legacy = { formatVersion: 1, index: JSON.parse(JSON.stringify(ms)), sources: current.sources };
    const restored = await LexicalIndex.fromSnapshot(legacy);
    expect(restored).not.toBeNull();
    expect(restored!.needsResave).toBe(true);
    expect(restored!.isFresh("n1", "v1")).toBe(true);
    expect(restored!.search("劣化")[0]?.chunkId).toBe("b1");
    // 書き直すと今の形式になる
    expect(restored!.toSnapshot().compact).toBeDefined();
  });

  it("壊れた詰めた形は復元しない（空から作り直す側に倒れる）", async () => {
    const snap = sample().toSnapshot();
    const broken = { ...snap, compact: { ...snap.compact!, postIds: new Uint32Array(0) } };
    expect(await LexicalIndex.fromSnapshot(broken)).toBeNull();
  });
});
