// @vitest-environment jsdom
// PROV グラフの Cytoscape elements 変換テスト
//
// 対象の不変条件:
// - cytoscape() に渡る elements の thumbnailUrl に http(s) の URL が 1 件も載らない。
//   Cytoscape は background-image を「描画時」（elements を渡した直後の rAF）に
//   読み込むため、マウント後の非同期ループで書き換えても最初の 1 枚には間に合わない。
//   PDF 書き出し（pdf-export）に至っては非同期ループ自体が無い。
//   よって判定は provToCytoscapeElements の内側で完結していなければならない。
// - 描いてよいのはローカル参照だけ（各プロバイダのアプリ内スキーム・blob: ・
//   data:image/ ・preview-image.ts の `media-text:<key>`）。
//   remote URL は取りに行かずサムネイルごと落とす（背景画像の無い素のノードになる）。
// - 旧データの第三者 favicon URL は normalizeFaviconUrl でサイト自身の favicon に
//   戻るが、戻した先も http(s) なので結局サムネイルは付かない。

import { describe, it, expect } from "vitest";
import { provToCytoscapeElements } from "./view";
import { previewImageRef } from "../asset-browser/media-index";
import type { ProvJsonLd, ProvJsonLdNode } from "./generator";

/** 旧実装が thumbnailUrl として永続化していた第三者 favicon URL。
 *  「第三者 favicon URL がソースに残っていないか」を見る grep sweep に
 *  テストのリテラルまで引っかからないよう、ホストとパスは分割して組み立てる。 */
const LEGACY_ORIGIN = "https://www.google.com";
const LEGACY_PATH_SEGMENTS = ["s2", "favicons"];
const LEGACY_PATH = `/${LEGACY_PATH_SEGMENTS.join("/")}`;
const legacyFavicon = (query: string) => `${LEGACY_ORIGIN}${LEGACY_PATH}?${query}&sz=64`;
const LEGACY = legacyFavicon("domain=internal.corp.example");
/** 拡張子付き（= 旧実装の画像 URL 判定に引っかかる）形の旧 URL */
const LEGACY_IMAGE = legacyFavicon("domain_url=https%3A%2F%2Fexample.com%2Flogo.png");

const doc = (nodes: ProvJsonLdNode[]): ProvJsonLd => ({
  "@context": {
    prov: "http://www.w3.org/ns/prov#",
    graphium: "https://graphium.app/ns#",
    rdfs: "http://www.w3.org/2000/01/rdf-schema#",
    xsd: "http://www.w3.org/2001/XMLSchema#",
  },
  "@graph": nodes,
});

type Elements = ReturnType<typeof provToCytoscapeElements>;

const thumbOf = (elements: Elements, id: string) =>
  elements.find((e) => e.data.id === id)?.data.thumbnailUrl as string | undefined;

const thumbsOf = (elements: Elements) =>
  elements.map((e) => e.data.thumbnailUrl).filter((u): u is string => typeof u === "string");

/** 1 ノードだけの文書を作り、その thumbnailUrl を取る */
const thumbForMedia = (url: string, mediaType = "image") =>
  thumbOf(
    provToCytoscapeElements(doc([
      {
        "@id": "e1",
        "@type": "prov:Entity",
        "rdfs:label": "素材",
        "graphium:mediaUrl": url,
        "graphium:mediaType": mediaType,
      },
    ])),
    "e1",
  );

describe("provToCytoscapeElements: remote URL は描画に載せない", () => {
  it("メディア Entity の remote 画像 URL はサムネイルにならない", () => {
    // 再現ケース: 配信元 CDN の hero 画像（クエリで一意に追跡できる形）。
    // 旧実装はこれをそのまま background-image にしていた。
    expect(thumbForMedia("https://cdn.publisher.example/hero-abc123.jpg?uid=tracked")).toBeUndefined();
  });

  it("graphium: パラメータ値の画像 URL はサムネイルにならずテキストで出る", () => {
    // 再現ケース: 画像 URL に見える任意のパラメータ値。旧実装は拡張子だけを見て
    // サムネイル化していたため、グラフを描くたびに計測ドメインへ GET が飛んでいた。
    const beacon = "https://tracker.example/beacon.png?id=42";
    const elements = provToCytoscapeElements(doc([
      {
        "@id": "e2",
        "@type": "prov:Entity",
        "rdfs:label": "装置",
        "graphium:someParam": beacon,
      },
    ]));

    const attr = elements.find((e) => e.data.type === "graphium:Attribute");
    expect(attr?.data.thumbnailUrl).toBeUndefined();
    // サムネイルを出せないので値はラベルに回る（描画はテキスト = 取得は発生しない）
    expect(attr?.data.label).toBe(`someParam: ${beacon}`);
  });

  it("graphium:attributes 配列の remote メディアもサムネイルにならない", () => {
    const elements = provToCytoscapeElements(doc([
      {
        "@id": "e3",
        "@type": "prov:Entity",
        "rdfs:label": "試料",
        "graphium:attributes": [
          {
            "rdfs:label": "出典",
            "graphium:mediaUrl": "https://cdn.publisher.example/fig1.webp?uid=tracked",
            "graphium:mediaType": "image",
          },
        ],
      },
    ]));

    const attr = elements.find((e) => e.data.label === "出典");
    expect(attr).toBeDefined();
    expect(attr?.data.thumbnailUrl).toBeUndefined();
  });

  it("remote 動画はサムネイルなし + ラベルにプレフィックス", () => {
    const elements = provToCytoscapeElements(doc([
      {
        "@id": "e4",
        "@type": "prov:Entity",
        "rdfs:label": "撮影",
        "graphium:mediaUrl": "https://cdn.publisher.example/clip.mp4",
        "graphium:mediaType": "video",
      },
    ]));

    const node = elements.find((e) => e.data.id === "e4");
    expect(node?.data.thumbnailUrl).toBeUndefined();
    expect(node?.data.label).toBe("▶ 撮影");
  });

  it("旧 Drive CDN URL（googleusercontent）もサムネイルにならない", () => {
    // 以前はサイズ指定だけ縮めて（=s80）そのまま描いていた。CDN は第三者なので落とす。
    expect(thumbForMedia("https://lh3.googleusercontent.com/d/abc=s200")).toBeUndefined();
  });

  it("第三者 favicon URL はサイト自身の favicon に戻しても remote なので落ちる", () => {
    expect(thumbForMedia(LEGACY)).toBeUndefined();
    expect(thumbForMedia(legacyFavicon("sz=64"))).toBeUndefined();
  });

  it("cytoscape() に渡る elements の thumbnailUrl に http(s) が 1 件も残らない", () => {
    const elements = provToCytoscapeElements(doc([
      {
        "@id": "e5",
        "@type": "prov:Entity",
        "rdfs:label": "A",
        "graphium:mediaUrl": LEGACY,
        "graphium:mediaType": "image",
        "graphium:icon": LEGACY_IMAGE,
        "graphium:hero": "https://cdn.publisher.example/hero-abc123.jpg?uid=tracked",
        "graphium:attributes": [
          { "rdfs:label": "B", "graphium:mediaUrl": LEGACY, "graphium:mediaType": "video" },
          {
            "rdfs:label": "C",
            "graphium:mediaUrl": "https://tracker.example/beacon.png?id=42",
            "graphium:mediaType": "image",
          },
        ],
      },
      {
        "@id": "e6",
        "@type": "prov:Entity",
        "rdfs:label": "D",
        // ローカル参照は従来どおり載る（「全部落として 0 件」では検出力が無い）
        "graphium:mediaUrl": "local-media://img-1",
        "graphium:mediaType": "image",
      },
    ]));

    const thumbs = thumbsOf(elements);
    expect(thumbs.filter((u) => /^https?:/i.test(u))).toEqual([]);
    expect(thumbs.some((u) => u.includes(LEGACY_PATH))).toBe(false);
    expect(thumbs).toContain("local-media://img-1");
  });
});

describe("provToCytoscapeElements: ローカル参照は従来どおり描く", () => {
  // 各ストレージプロバイダのスキームと、すでに手元に実体がある形。
  // 実際に描ける URL への解決（blob 化・動画フレーム抽出）は CytoscapeGraph の
  // 非同期ループが行うので、ここでは参照がそのまま載ることだけを見る。
  const LOCAL_REFS = [
    "file-media://img-1",       // filesystem プロバイダ（Tauri）
    "local-media://img-1",      // local プロバイダ（IndexedDB）
    "media-server://img-1",     // server-fs プロバイダ（同一オリジンの sidecar）
    "media://img-1",            // 旧データに残る汎用スキーム
    "blob:http://localhost/9f0e",
    "data:image/png;base64,iVBORw0KGgo=",
  ];

  for (const ref of LOCAL_REFS) {
    it(`${ref.split(":")[0]}: のメディアはサムネイルになる`, () => {
      expect(thumbForMedia(ref)).toBe(ref);
    });
  }

  it("preview-image のローカル参照（media-text:）も落とさない", () => {
    const ref = previewImageRef("url_1700000000_ab12")!;
    expect(ref.startsWith("media-text:")).toBe(true);
    expect(thumbForMedia(ref)).toBe(ref);
  });

  it("graphium: パラメータ値がローカル参照ならサムネイルにする", () => {
    const elements = provToCytoscapeElements(doc([
      {
        "@id": "e7",
        "@type": "prov:Entity",
        "rdfs:label": "装置",
        "graphium:icon": "local-media://icon-1",
      },
    ]));

    const attr = elements.find((e) => e.data.type === "graphium:Attribute");
    expect(attr?.data.thumbnailUrl).toBe("local-media://icon-1");
    // サムネイルが出せるのでラベルは値を含めない
    expect(attr?.data.label).toBe("icon");
  });

  it("音声・ファイルは従来どおりサムネイルなし + ラベルにプレフィックス", () => {
    const elements = provToCytoscapeElements(doc([
      {
        "@id": "e8",
        "@type": "prov:Entity",
        "rdfs:label": "録音",
        "graphium:mediaUrl": "local-media://audio-1",
        "graphium:mediaType": "audio",
      },
    ]));

    const node = elements.find((e) => e.data.id === "e8");
    expect(node?.data.thumbnailUrl).toBeUndefined();
    expect(node?.data.label).toBe("♫ 録音");
  });
});
