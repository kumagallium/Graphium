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
});
