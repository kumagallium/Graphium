// LexicalIndex（MiniSearch ラッパ）のテスト
// - ソース単位の投入・差し替え・削除
// - fingerprint が同じなら再索引しない
// - 日本語 / 英語 / 化学式で当たる。タイトルは本文より強い
// - kinds / excludeSourceIds / perSourceLimit のフィルタ
// - スナップショット往復で検索結果が変わらない

import { describe, expect, it } from "vitest";
import { LEXICAL_FORMAT_VERSION, LexicalIndex, docId, miniSearchOptions } from "./lexical-index";

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

describe("LexicalIndex — listChunks / vocabulary", () => {
  it("チャンクの本文と索引された語が見え、語彙は df 順で discard 済みを数えない", () => {
    const idx = sampleIndex();
    const chunks = idx.listChunks("n1");
    expect(chunks.map((c) => c.chunkId)).toEqual(["b1", "b2"]);
    expect(chunks[0].text).toContain("湿度");
    expect(chunks[0].terms).toContain("湿度");
    expect(chunks[0].terms).toContain("劣化");
    // タイトルの語も索引されている（title フィールド）
    expect(chunks[0].terms).toContain("試薬");
    expect(idx.listChunks("nope")).toEqual([]);

    const vocab = idx.vocabulary();
    const df = new Map(vocab.map((v) => [v.term, v.df]));
    // "デシケーター" は n1 の b1 と w1 の lead（title + text）の 2 断片
    expect(df.get("デシケーター")).toBe(2);
    expect(vocab[0].df).toBeGreaterThanOrEqual(vocab[vocab.length - 1].df);
    expect(idx.termCount).toBeGreaterThan(0);

    // ソースを外すと語彙からも消える（discard 済みは数えない）
    idx.removeSource("a1");
    expect(idx.vocabulary().find((v) => v.term === "ppms")).toBeUndefined();
  });
});

describe("LexicalIndex — 掃除（vacuum）", () => {
  // MiniSearch の自動 vacuum は転置索引を 1000 語ごとに await で中断しながら掃除する。
  // その中断中に addAll が走ると radix tree が組み変わり、掃除側のイテレータが宙を指して
  // 落ちる（TypeError: ... reading 'keys'）。reconcile は「1 ソース索引 → 譲る」を
  // 繰り返すので必ず噛み合う。だから自動 vacuum は切って、途中で譲らない掃除を明示で走らせる

  /** term 数が MiniSearch の中断単位（1000 語）を超える索引を作る */
  function bigIndex(sources: number, generation = 0): LexicalIndex {
    const idx = new LexicalIndex();
    for (let s = 0; s < sources; s++) idx.upsertSource(bigSource(s, generation));
    return idx;
  }

  function bigSource(s: number, generation: number) {
    return {
      kind: "note" as const,
      sourceId: `n${s}`,
      title: `ノート ${s}`,
      fingerprint: `v${generation}`,
      chunks: [0, 1, 2].map((c) => ({
        chunkId: `b${c}`,
        // ソース固有の語で語彙を広げつつ、共通語も混ぜて df を持たせる
        text:
          Array.from({ length: 40 }, (_, i) => `s${s}g${generation}c${c}w${i}`).join(" ") +
          " " +
          Array.from({ length: 20 }, (_, i) => `common${(s + i) % 200}`).join(" "),
      })),
    };
  }

  it("自動 vacuum を無効にしている（有効だと reconcile 中に索引が壊れる）", () => {
    expect(miniSearchOptions().autoVacuum).toBe(false);
  });

  it("残骸が溜まっていなければ掃除しない", async () => {
    const idx = sampleIndex();
    expect(await idx.vacuumIfDirty()).toBe(false);
    idx.removeSource("a1");
    // 削除は 2 チャンクだけ。しきい値（20 件）に届かないので掃除しない
    expect(await idx.vacuumIfDirty()).toBe(false);
  });

  it("溜まった残骸を落とし、検索結果は変わらない", async () => {
    const idx = bigIndex(40);
    const before = idx.termCount;
    for (let s = 0; s < 20; s++) idx.removeSource(`n${s}`);

    const hitsBeforeVacuum = idx.search("common7", { limit: 100 });
    expect(await idx.vacuumIfDirty()).toBe(true);
    const hitsAfterVacuum = idx.search("common7", { limit: 100 });

    // 掃除で語彙は減る（削除済みだけを含んでいた語が落ちる）
    expect(idx.termCount).toBeLessThan(before);
    // 掃除は検索結果にもスコアにも影響しない（残骸は元から結果に出ない）
    expect(hitsAfterVacuum.map((h) => h.id)).toEqual(hitsBeforeVacuum.map((h) => h.id));
    expect(hitsAfterVacuum.map((h) => h.score)).toEqual(hitsBeforeVacuum.map((h) => h.score));
    // 残っているソースは全部引ける
    expect(idx.sourceCount).toBe(20);
    expect(idx.search("s25g0c0w5")[0]?.sourceId).toBe("n25");
    // 消したソースは引けない
    expect(idx.search("s5g0c0w5")).toEqual([]);
  });

  it("reconcile と同じ形（1 ソースずつ差し替えて譲る）を繰り返しても壊れない", async () => {
    const idx = bigIndex(40);
    const errors: unknown[] = [];
    const onUnhandled = (e: PromiseRejectionEvent | unknown) => errors.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      // service.reconcile と同じ: upsertSource → イベントループに譲る、を全ソース分
      for (let generation = 1; generation <= 3; generation++) {
        for (let s = 0; s < 40; s++) {
          idx.upsertSource(bigSource(s, generation));
          // 保存（saveNow）の掃除が並走で挟まる状況を再現する
          await idx.vacuumIfDirty();
          await new Promise<void>((r) => setTimeout(r, 0));
        }
      }
      // 宙に浮いた rejection が届くのを待つ
      await new Promise<void>((r) => setTimeout(r, 50));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    expect(errors).toEqual([]);
    expect(idx.sourceCount).toBe(40);
    expect(idx.documentCount).toBe(120);
    // 最新世代の語で引け、古い世代の語は消えている
    expect(idx.search("s7g3c0w5")[0]?.sourceId).toBe("n7");
    expect(idx.search("s7g0c0w5")).toEqual([]);
  });
});
