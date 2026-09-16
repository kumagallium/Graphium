// Wiki Retriever のテスト。IndexedDB は fake-indexeddb（node 環境、DOM 不要）。
//
// 対象の不変条件（最重要 = embedding が使えなくても Wiki 知識が届く）:
// - フォールバック（テキストマッチ）Retriever は、embedding-store が DB を現行
//   バージョンで開いた後でも読める。かつて retriever が DB を固定の v1 で開き直して
//   いたため、embedding-store の DB_VERSION が 2 に上がった時点で VersionError が
//   出て常に null を返していた（= フォールバックが事実上死んでいた）回帰
// - レコードが 0 件でも wiki インデックスだけは <wiki-index> として注入する
// - embedding API が落ちていても retrieveWikiContext はフォールバック経由で返す
// - excludeIds（@引用済み等）に入っている wiki は候補から外す

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { embeddingStore } from "../../lib/embedding-store";
import {
  retrieveWikiContext,
  retrieveWikiContextFallback,
  setWikiIndexForRetriever,
  setWikiTitleMap,
  setWikiKindMap,
  setWikiTopicMembers,
  clampEmbedQuery,
  formatRetrievedContext,
  type RetrievedPassage,
  MAX_EMBED_QUERY_CHARS,
} from "./retriever";

/**
 * embedWikiSections の text-only フォールバック分岐と同じ形で保存する
 * （空ベクトル + modelVersion "text-only"）。これを 1 回でも呼ぶと
 * DB は embedding-store の現行 DB_VERSION で作られる。
 */
function seedTextOnly(documentId: string, sectionId: string, text: string): Promise<void> {
  return embeddingStore.setEmbedding(documentId, sectionId, [], "text-only", text);
}

beforeEach(() => {
  // テストごとに素の IndexedDB
  vi.stubGlobal("indexedDB", new IDBFactory());
  // retriever のモジュール状態（タイトルマップ / 種別マップ / インデックス）もリセット
  setWikiTitleMap(new Map());
  setWikiKindMap(new Map());
  setWikiIndexForRetriever("");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("retrieveWikiContextFallback", () => {
  it("reads text-only records after embedding-store has opened the DB at its current version", async () => {
    await seedTextOnly("wiki-zno", "sec-1", "Thermal conductivity of ZnO decreases with porosity");
    await seedTextOnly("wiki-pottery", "sec-1", "Unrelated note about pottery glazing");
    setWikiTitleMap(
      new Map([
        ["wiki-zno", "ZnO thermal transport"],
        ["wiki-pottery", "Pottery"],
      ]),
    );

    const ctx = await retrieveWikiContextFallback("zno porosity conductivity");

    // 以前はここで VersionError → catch → null になっていた
    expect(ctx).not.toBeNull();
    expect(ctx).toContain("<knowledge>");
    expect(ctx).toContain('[#1 | Claim | "ZnO thermal transport"]');
    expect(ctx).toContain("Thermal conductivity of ZnO decreases with porosity");
    // 単語が 1 つも一致しないページは載せない
    expect(ctx).not.toContain("Pottery");
  });

  it("drops documents listed in excludeIds (already cited / derived knowledge)", async () => {
    await seedTextOnly("wiki-zno", "sec-1", "Thermal conductivity of ZnO decreases with porosity");
    await seedTextOnly("wiki-zno-2", "sec-1", "ZnO porosity also affects the Seebeck coefficient");
    setWikiTitleMap(
      new Map([
        ["wiki-zno", "ZnO thermal transport"],
        ["wiki-zno-2", "ZnO porosity vs Seebeck"],
      ]),
    );

    const ctx = await retrieveWikiContextFallback("zno porosity", new Set(["wiki-zno"]));

    // 除外した方は消え、残った方が [#1] として載る
    expect(ctx).not.toBeNull();
    expect(ctx).toContain('[#1 | Claim | "ZnO porosity vs Seebeck"]');
    expect(ctx).not.toContain("ZnO thermal transport");
    expect(ctx).not.toContain("Thermal conductivity of ZnO decreases with porosity");
  });

  it("still injects <wiki-index> when the store exists but holds no records", async () => {
    // embedding-store 経由の操作で DB は現行バージョンで作られるが、中身は空
    await embeddingStore.clear();
    setWikiIndexForRetriever("- ZnO thermal transport\n- Pottery");

    const ctx = await retrieveWikiContextFallback("anything at all");

    // 以前は VersionError が先に投げられ、この最終フォールバックにも到達しなかった
    expect(ctx).not.toBeNull();
    expect(ctx).toContain("<wiki-index>");
    expect(ctx).toContain("- ZnO thermal transport");
    expect(ctx).not.toContain("<knowledge>");
  });

  it("returns null when there are neither records nor a wiki index", async () => {
    expect(await retrieveWikiContextFallback("anything")).toBeNull();
  });
});

describe("retrieveWikiContext", () => {
  it("falls back to text match when the embedding endpoint is unreachable", async () => {
    // embedding モデル未設定 / 非対応プロバイダー / ネットワーク断はいずれも
    // 「/wiki/embed が使えない」に帰着する。ここでは fetch 自体を落とす。
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await seedTextOnly("wiki-seebeck", "sec-1", "Seebeck coefficient rises with light doping");
    setWikiTitleMap(new Map([["wiki-seebeck", "Seebeck coefficient"]]));

    const ctx = await retrieveWikiContext("seebeck doping");

    expect(ctx).not.toBeNull();
    expect(ctx).toContain('[#1 | Claim | "Seebeck coefficient"]');
    expect(ctx).toContain("Seebeck coefficient rises with light doping");
  });

  it("clamps the embedding query so a pasted note body cannot exceed the model's input limit", async () => {
    // 2026-08-17 の実例: 質問文にノート全文（XRD テーブル数百行）が同梱されたまま
    // 埋め込み API へ渡り、multilingual-e5-large の上限 512 トークンを大きく超えて
    // 400 になった。呼び出し側は質問文だけ渡す約束になったが、ここでも上限で切る。
    const sent: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: { body?: string }) => {
        const body = JSON.parse(init?.body ?? "{}") as { texts?: { text: string }[] };
        sent.push(body.texts?.[0]?.text ?? "");
        return { ok: true, json: async () => ({ embeddings: [] }) } as Response;
      }),
    );
    await seedTextOnly("wiki-x", "sec-1", "unrelated");

    const hugeQuery = "XRD peaks question " + "| 21.34 | 4.161 | 5.0 | (0,0,2) |\n".repeat(2000);
    expect(hugeQuery.length).toBeGreaterThan(MAX_EMBED_QUERY_CHARS * 10);
    await retrieveWikiContext(hugeQuery);

    expect(sent).toHaveLength(1);
    expect(sent[0].length).toBeLessThanOrEqual(MAX_EMBED_QUERY_CHARS);
    // 先頭（質問の主題）は残る
    expect(sent[0].startsWith("XRD peaks question")).toBe(true);
  });
});

describe("kind ごとのセクション分け（<knowledge> は WikiKind でブロックを分ける）", () => {
  it("種別マップに登録された WikiKind でブロック見出しとマーカーの種別名を出す", async () => {
    await seedTextOnly("wiki-topic", "sec-1", "Topic page bundling several claims about porosity");
    await seedTextOnly("wiki-atom", "sec-1", "Insight pattern about porosity generalized across multiple claims");
    setWikiTitleMap(
      new Map([
        ["wiki-topic", "Porosity topic"],
        ["wiki-atom", "Porosity insight"],
      ]),
    );
    setWikiKindMap(
      new Map([
        ["wiki-topic", "topic"],
        ["wiki-atom", "atom"],
      ]),
    );

    const ctx = await retrieveWikiContextFallback("porosity");

    expect(ctx).not.toBeNull();
    // 種別ごとの見出し（WIKI_KIND_ORDER の順 = Topics が Insights より先）
    expect(ctx).toContain("--- Topics ---");
    expect(ctx).toContain("--- Insights ---");
    expect(ctx!.indexOf("--- Topics ---")).toBeLessThan(ctx!.indexOf("--- Insights ---"));
    // マーカーにも種別名が入る
    expect(ctx).toContain('[#1 | Topic | "Porosity topic"]');
    expect(ctx).toContain('Insight | "Porosity insight"');
  });

  it("種別マップに未登録の sourceId は既定の claim として扱う（section-extract.ts の既定と揃える）", async () => {
    await seedTextOnly("wiki-unknown", "sec-1", "porosity affects thermal conductivity");
    setWikiTitleMap(new Map([["wiki-unknown", "Unlabeled page"]]));
    // setWikiKindMap は呼ばない（beforeEach でリセット済みの空マップのまま）

    const ctx = await retrieveWikiContextFallback("porosity");

    expect(ctx).not.toBeNull();
    expect(ctx).toContain("--- Claims ---");
    expect(ctx).toContain('[#1 | Claim | "Unlabeled page"]');
  });

  it("ヒットしなかった種別のブロックは出さない", async () => {
    await seedTextOnly("wiki-claim-only", "sec-1", "porosity lowers thermal conductivity");
    setWikiTitleMap(new Map([["wiki-claim-only", "Claim only page"]]));
    setWikiKindMap(new Map([["wiki-claim-only", "claim"]]));

    const ctx = await retrieveWikiContextFallback("porosity");

    expect(ctx).not.toBeNull();
    expect(ctx).toContain("--- Claims ---");
    expect(ctx).not.toContain("--- Topics ---");
    expect(ctx).not.toContain("--- Insights ---");
    expect(ctx).not.toContain("--- Summaries ---");
  });
});

describe("文字数予算（MAX_CONTEXT_CHARS）が件数の蓋の代わりに効く", () => {
  it("合計が予算を超える断片は途中で打ち切り、先頭側だけが残る", async () => {
    // 1 件あたり ~900 字。4 件全部だと 2000（MAX_CONTEXT_CHARS）を超えるので、
    // 件数キャップ（旧 TOP_K）が無くても文字数予算だけで打ち切られることを確認する。
    const filler = "porosity reduces thermal conductivity via phonon scattering. ".repeat(14);
    for (let i = 0; i < 4; i++) {
      await seedTextOnly(`wiki-budget-${i}`, "sec-1", filler);
    }
    setWikiTitleMap(
      new Map([
        ["wiki-budget-0", "Budget page 0"],
        ["wiki-budget-1", "Budget page 1"],
        ["wiki-budget-2", "Budget page 2"],
        ["wiki-budget-3", "Budget page 3"],
      ]),
    );

    const ctx = await retrieveWikiContextFallback("porosity thermal conductivity phonon scattering");

    expect(ctx).not.toBeNull();
    expect(ctx).toContain("Budget page 0");
    // 予算超過で末尾まで入り切らない
    expect(ctx).not.toContain("Budget page 3");
  });
});

describe("種別分けの表示は RRF 融合順の採否を変えない（予算はランク順で決まる）", () => {
  it("kind 優先で予算を消費すると RRF 上位の断片が弾かれてしまう回帰: 採否は fuse 結果の元の順で決める", () => {
    // fuse 結果の順（= 最上位ランク → 下位）で claim（高ランク）→ topic（低ランク）の順に並べる。
    // WIKI_KIND_ORDER の表示順は topic が claim より先だが、採否はこの表示順に引きずられては
    // いけない（引きずられると、先に処理される topic が予算を食って高ランクの claim が丸ごと
    // 弾かれてしまう）
    setWikiTitleMap(
      new Map([
        ["wiki-claim-high", "Claim high title"],
        ["wiki-topic-low", "Topic low title"],
      ]),
    );
    setWikiKindMap(
      new Map([
        ["wiki-claim-high", "claim"],
        ["wiki-topic-low", "topic"],
      ]),
    );
    const wikiSections: RetrievedPassage[] = [
      { kind: "wiki", sourceId: "wiki-claim-high", chunkId: "c1", title: "", text: "x".repeat(1700), score: 2 },
      { kind: "wiki", sourceId: "wiki-topic-low", chunkId: "c2", title: "", text: "y".repeat(400), score: 1 },
    ];

    const ctx = formatRetrievedContext(wikiSections, []);

    expect(ctx).not.toBeNull();
    // RRF 最上位の claim は残る
    expect(ctx).toContain("--- Claims ---");
    expect(ctx).toContain("Claim high title");
    // 予算超過で下位の topic は丸ごと弾かれる（kind 優先で先に処理されて残ってしまってはいけない）
    expect(ctx).not.toContain("--- Topics ---");
    expect(ctx).not.toContain("Topic low title");
  });
});

describe("clampEmbedQuery", () => {
  it("上限以下はそのまま（前後空白だけ落とす）", () => {
    expect(clampEmbedQuery("  short query  ")).toBe("short query");
  });

  it("上限を超えたら先頭 MAX_EMBED_QUERY_CHARS 文字に切る", () => {
    const long = "あ".repeat(MAX_EMBED_QUERY_CHARS + 500);
    expect(clampEmbedQuery(long)).toHaveLength(MAX_EMBED_QUERY_CHARS);
  });

  it("空白のみは空文字（呼び出し側が検索をスキップできる）", () => {
    expect(clampEmbedQuery("   \n  ")).toBe("");
  });
});

describe("トピックのメンバー知見", () => {
  it("トピックの断片には束ねている知見のタイトルが 1 行付き、他の種別には付かない", () => {
    setWikiTitleMap(new Map([["t1", "熱伝導率"], ["c1", "知見 A"]]));
    setWikiKindMap(new Map([["t1", "topic"], ["c1", "claim"]]));
    setWikiTopicMembers(new Map([["t1", ["知見 A", "知見 B"]]]));
    const out = formatRetrievedContext(
      [
        { kind: "wiki", sourceId: "t1", chunkId: "s1", title: "熱伝導率", text: "定義。", score: 1 },
        { kind: "wiki", sourceId: "c1", chunkId: "s1", title: "知見 A", text: "命題。", score: 0.9 },
      ],
      [],
    );
    expect(out).toContain('Groups these claims: "知見 A", "知見 B"');
    expect(out?.split('[#2 | Claim | "知見 A"]')[1]).not.toContain("Groups these claims");
    setWikiTopicMembers(new Map());
  });

  it("メンバーが分からないトピックには行を足さない", () => {
    setWikiTitleMap(new Map([["t1", "熱伝導率"]]));
    setWikiKindMap(new Map([["t1", "topic"]]));
    setWikiTopicMembers(new Map());
    const out = formatRetrievedContext(
      [{ kind: "wiki", sourceId: "t1", chunkId: "s1", title: "熱伝導率", text: "定義。", score: 1 }],
      [],
    );
    expect(out).not.toContain("Groups these claims");
  });
});
