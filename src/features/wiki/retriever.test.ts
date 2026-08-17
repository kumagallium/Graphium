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
  clampEmbedQuery,
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
  // retriever のモジュール状態（タイトルマップ / インデックス）もリセット
  setWikiTitleMap(new Map());
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
    expect(ctx).toContain('[#1 | "ZnO thermal transport"]');
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
    expect(ctx).toContain('[#1 | "ZnO porosity vs Seebeck"]');
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
    expect(ctx).toContain('[#1 | "Seebeck coefficient"]');
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
