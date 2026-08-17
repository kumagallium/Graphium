// LexicalIndex（MiniSearch ラッパ）のテスト
// - ソース単位の投入・差し替え・削除
// - fingerprint が同じなら再索引しない
// - 日本語 / 英語 / 化学式で当たる。タイトルは本文より強い
// - kinds / excludeSourceIds / perSourceLimit のフィルタ
// - スナップショット往復で検索結果が変わらない

import { describe, expect, it } from "vitest";
import { LEXICAL_FORMAT_VERSION, LexicalIndex, docId } from "./lexical-index";

function sampleIndex(): LexicalIndex {
  const idx = new LexicalIndex();
  idx.upsertSource({
    kind: "note",
    sourceId: "n1",
    title: "試薬 X の保管",
    fingerprint: "v1",
    chunks: [
      { chunkId: "b1", text: "湿度 60% 以上で試薬 X が劣化する。デシケーター保管が必須。" },
      { chunkId: "b2", text: "Bi2Te3 の焼結条件を検討した。" },
    ],
  });
  idx.upsertSource({
    kind: "wiki",
    sourceId: "w1",
    title: "デシケーター運用",
    fingerprint: "v1",
    chunks: [{ chunkId: "lead", text: "claim: デシケーター運用: 乾燥剤は 2 週間で交換する" }],
  });
  idx.upsertSource({
    kind: "asset",
    sourceId: "a1",
    title: "ppms-manual.pdf",
    fingerprint: "v1",
    chunks: [
      { chunkId: "c0", text: "PPMS の thermal transport option (TTO) で熱伝導率を測定する。" },
      { chunkId: "c1", text: "サンプルホルダーの取り付け手順。" },
    ],
  });
  return idx;
}

describe("LexicalIndex", () => {
  it("投入したソースとチャンク数を数える", () => {
    const idx = sampleIndex();
    expect(idx.sourceCount).toBe(3);
    expect(idx.documentCount).toBe(5);
    expect(idx.hasSource("n1")).toBe(true);
    expect(idx.listSourceIds("asset")).toEqual(["a1"]);
  });

  it("日本語の語で本文に当たり、ソース情報が返る", () => {
    const idx = sampleIndex();
    const hits = idx.search("劣化");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toMatchObject({ kind: "note", sourceId: "n1", chunkId: "b1", title: "試薬 X の保管" });
    expect(hits[0].text).toContain("劣化");
  });

  it("化学式・英語（大文字小文字無視）で当たる", () => {
    const idx = sampleIndex();
    expect(idx.search("bi2te3")[0]?.chunkId).toBe("b2");
    expect(idx.search("ppms")[0]?.sourceId).toBe("a1");
    expect(idx.search("Thermal")[0]?.sourceId).toBe("a1");
  });

  it("タイトルだけに当たる語でもソースが返り、タイトル一致は本文一致より上位", () => {
    const idx = sampleIndex();
    const hits = idx.search("デシケーター");
    // w1 はタイトルと本文の両方に、n1 は本文のみに含む → w1 が上
    expect(hits[0].sourceId).toBe("w1");
    expect(hits.map((h) => h.sourceId)).toContain("n1");
  });

  it("最後の語は前方一致（打鍵中）", () => {
    const idx = sampleIndex();
    expect(idx.search("therm").some((h) => h.sourceId === "a1")).toBe(true);
    expect(idx.search("therm", { prefixLastTerm: false }).some((h) => h.sourceId === "a1")).toBe(false);
  });

  it("kinds / excludeSourceIds / perSourceLimit で絞れる", () => {
    const idx = sampleIndex();
    expect(idx.search("デシケーター", { kinds: ["note"] }).every((h) => h.kind === "note")).toBe(true);
    expect(idx.search("デシケーター", { excludeSourceIds: new Set(["w1"]) }).some((h) => h.sourceId === "w1")).toBe(false);
    // "の" のような語は複数チャンクに当たる。perSourceLimit=1 でソースごと 1 件に
    idx.upsertSource({
      kind: "note",
      sourceId: "n2",
      title: "多段",
      fingerprint: "v1",
      chunks: [
        { chunkId: "x1", text: "熱伝導率の測定" },
        { chunkId: "x2", text: "熱伝導率の解析" },
      ],
    });
    const hits = idx.search("熱伝導率", { perSourceLimit: 1 });
    const n2 = hits.filter((h) => h.sourceId === "n2");
    expect(n2.length).toBe(1);
  });

  it("同じ fingerprint なら再索引しない。変わればチャンクが差し替わる", () => {
    const idx = sampleIndex();
    expect(
      idx.upsertSource({ kind: "note", sourceId: "n1", title: "試薬 X の保管", fingerprint: "v1", chunks: [] }),
    ).toBe(false);
    expect(idx.documentCount).toBe(5);
    expect(
      idx.upsertSource({
        kind: "note",
        sourceId: "n1",
        title: "試薬 X の保管（改）",
        fingerprint: "v2",
        chunks: [{ chunkId: "b9", text: "改訂: 窒素雰囲気で保管する" }],
      }),
    ).toBe(true);
    expect(idx.search("劣化").some((h) => h.sourceId === "n1")).toBe(false);
    expect(idx.search("窒素")[0]?.chunkId).toBe("b9");
    expect(idx.getSourceMeta("n1")?.chunkIds).toEqual(["b9"]);
  });

  it("ソース削除で検索から消える。存在しない id は false", () => {
    const idx = sampleIndex();
    expect(idx.removeSource("a1")).toBe(true);
    expect(idx.removeSource("a1")).toBe(false);
    expect(idx.search("ppms")).toEqual([]);
    expect(idx.hasSource("a1")).toBe(false);
  });

  it("空本文のチャンクは索引しない。重複 chunkId は両方残る", () => {
    const idx = new LexicalIndex();
    idx.upsertSource({
      kind: "note",
      sourceId: "n",
      title: "t",
      fingerprint: "1",
      chunks: [
        { chunkId: "a", text: "   " },
        { chunkId: "b", text: "one" },
        { chunkId: "b", text: "two" },
      ],
    });
    expect(idx.documentCount).toBe(2);
    expect(idx.getSourceMeta("n")?.chunkIds).toEqual(["b", "b#1"]);
    expect(docId("note", "n", "b")).toBe("note:n:b");
  });

  it("スナップショット往復で同じ結果になる", async () => {
    const idx = sampleIndex();
    const snap = idx.toSnapshot();
    expect(snap.formatVersion).toBe(LEXICAL_FORMAT_VERSION);
    // JSON 化して戻す（IndexedDB の structuredClone 相当）
    const restored = await LexicalIndex.fromSnapshot(JSON.parse(JSON.stringify(snap)));
    expect(restored).not.toBeNull();
    expect(restored!.documentCount).toBe(5);
    expect(restored!.isFresh("n1", "v1")).toBe(true);
    expect(restored!.search("劣化")[0]?.chunkId).toBe("b1");
    // 復元後も差し替え・削除が効く
    expect(restored!.removeSource("n1")).toBe(true);
    expect(restored!.search("劣化")).toEqual([]);
  });

  it("形式バージョンが違うスナップショットは復元しない", async () => {
    const idx = sampleIndex();
    const snap = { ...idx.toSnapshot(), formatVersion: LEXICAL_FORMAT_VERSION + 1 };
    expect(await LexicalIndex.fromSnapshot(snap)).toBeNull();
    expect(await LexicalIndex.fromSnapshot(null)).toBeNull();
  });

  it("空クエリ・空索引は空", () => {
    expect(new LexicalIndex().search("劣化")).toEqual([]);
    expect(sampleIndex().search("   ")).toEqual([]);
  });
});

describe("LexicalIndex — minTermMatches", () => {
  it("2 語以上当たった候補だけを残す。クエリが 1 語ならそのまま", () => {
    const idx = new LexicalIndex();
    idx.upsertSource({ kind: "note", sourceId: "both", title: "t", fingerprint: "1", chunks: [{ chunkId: "a", text: "PPMS で thermal を測る" }] });
    idx.upsertSource({ kind: "note", sourceId: "one", title: "t", fingerprint: "1", chunks: [{ chunkId: "a", text: "PPMS だけ" }] });
    const loose = idx.search("PPMS thermal", { prefixLastTerm: false });
    expect(loose.map((h) => h.sourceId).sort()).toEqual(["both", "one"]);
    const strict = idx.search("PPMS thermal", { prefixLastTerm: false, minTermMatches: 2 });
    expect(strict.map((h) => h.sourceId)).toEqual(["both"]);
    // 1 語クエリでは 1 に丸められ、落とさない
    expect(idx.search("PPMS", { prefixLastTerm: false, minTermMatches: 2 }).length).toBe(2);
  });
});

describe("LexicalIndex — listSources", () => {
  it("種類・タイトル・断片数を返し、本文が空のソースもタイトル付きで載る。スナップショット往復でも保たれる", async () => {
    const idx = sampleIndex();
    idx.upsertSource({ kind: "note", sourceId: "empty", title: "空のノート", fingerprint: "1", chunks: [] });
    const list = idx.listSources();
    expect(list.find((s) => s.sourceId === "n1")).toMatchObject({ kind: "note", title: "試薬 X の保管", chunkCount: 2 });
    expect(list.find((s) => s.sourceId === "empty")).toMatchObject({ kind: "note", title: "空のノート", chunkCount: 0 });
    const restored = await LexicalIndex.fromSnapshot(JSON.parse(JSON.stringify(idx.toSnapshot())));
    expect(restored!.listSources().find((s) => s.sourceId === "empty")?.title).toBe("空のノート");
    expect(restored!.listSources().find((s) => s.sourceId === "a1")?.title).toBe("ppms-manual.pdf");
  });
});
