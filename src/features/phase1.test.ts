import { describe, it, expect } from "vitest";
import { isProvLink, PROV_LINK_TYPES } from "./block-link/link-types";
import { normalizeLabel, classifyLabel, getHeadingLabelRole } from "./context-label/labels";
import { generateProvDocument, extractRelations } from "./prov-generator/generator";

// ──────────────────────────────────
// 1.3 リンクの二層分離
// ──────────────────────────────────
describe("リンクの二層分離", () => {
  it("isProvLink は PROV リンクタイプを正しく判定する", () => {
    expect(isProvLink("derived_from")).toBe(true);
    expect(isProvLink("used")).toBe(true);
    expect(isProvLink("generated")).toBe(true);
    expect(isProvLink("reproduction_of")).toBe(true);
    expect(isProvLink("informed_by")).toBe(true);
  });

  it("isProvLink は知識層リンクに false を返す", () => {
    expect(isProvLink("reference")).toBe(false);
  });

  it("PROV_LINK_TYPES に 5 種類のリンクタイプがある", () => {
    expect(PROV_LINK_TYPES.size).toBe(5);
  });

  it("知識層リンクは PROV グラフに含まれない", () => {
    const blocks = [
      { id: "h2-step", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "手順1" }], children: [] },
    ];
    const labels = new Map([["h2-step", "procedure"]]);
    const links = [
      { id: "ref-1", sourceBlockId: "h2-step", targetBlockId: "some-block", type: "reference" as const, layer: "knowledge" as const, createdBy: "human" as const },
    ];
    const doc = generateProvDocument({ blocks, labels, links });
    // 埋め込み形式なので extractRelations で確認
    const relations = extractRelations(doc);
    expect(relations).toHaveLength(0);
    // Activity は生成される
    expect(doc["@graph"]).toHaveLength(1);
  });
});

// ──────────────────────────────────
// 1.4 attribute の PROV 名変更
// ──────────────────────────────────
describe("attribute の PROV 名変更", () => {
  it("attribute ブロックが独立ノードではなく親の graphium:attributes に埋め込まれる", () => {
    const blocks = [
      { id: "h2-step", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "焼結" }], children: [] },
      { id: "attr-1", type: "paragraph", content: [{ type: "text", text: "温度 800℃" }], children: [] },
    ];
    const labels = new Map([["h2-step", "procedure"], ["attr-1", "attribute"]]);
    const doc = generateProvDocument({ blocks, labels, links: [] });

    // param_ ノードは生成されない
    const paramNode = doc["@graph"].find((n) => n["@id"] === "param_attr-1");
    expect(paramNode).toBeUndefined();
    // Activity に埋め込み
    const act = doc["@graph"].find((n) => n["@id"] === "activity_h2-step");
    expect(act?.["graphium:attributes"]).toHaveLength(1);
    expect(act!["graphium:attributes"]![0]["rdfs:label"]).toBe("温度 800℃");
  });

  it("attribute が親 Activity の graphium:attributes に埋め込まれる", () => {
    const blocks = [
      { id: "h2-step", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "焼結" }], children: [] },
      { id: "attr-1", type: "paragraph", content: [{ type: "text", text: "温度 800℃" }], children: [] },
    ];
    const labels = new Map([["h2-step", "procedure"], ["attr-1", "attribute"]]);
    const doc = generateProvDocument({ blocks, labels, links: [] });

    // param_ ノードは生成されない
    expect(doc["@graph"].filter((n) => n["@id"].startsWith("param_"))).toHaveLength(0);
    // Activity に属性が埋め込まれている
    const act = doc["@graph"].find((n) => n["@id"] === "activity_h2-step");
    expect(act?.["graphium:attributes"]).toBeDefined();
    expect(act!["graphium:attributes"]![0]["rdfs:label"]).toBe("温度 800℃");
  });

  it("@context に graphium, rdfs, xsd が含まれる", () => {
    const blocks = [
      { id: "h2-step", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "手順" }], children: [] },
    ];
    const labels = new Map([["h2-step", "procedure"]]);
    const doc = generateProvDocument({ blocks, labels, links: [] });
    expect(doc["@context"].graphium).toBe("https://graphium.app/ns#");
    expect(doc["@context"].rdfs).toBe("http://www.w3.org/2000/01/rdf-schema#");
    expect(doc["@context"].xsd).toBe("http://www.w3.org/2001/XMLSchema#");
    expect((doc["@context"] as any).matprov).toBeUndefined();
  });
});

// ──────────────────────────────────
// ラベルの追加エイリアス
// ──────────────────────────────────
describe("ラベルエイリアス拡張", () => {
  it("旧ブラケット日本語が内部キーに正規化される", () => {
    expect(normalizeLabel("[手順]")).toBe("procedure");
    expect(normalizeLabel("[材料]")).toBe("material");
    expect(normalizeLabel("[ツール]")).toBe("tool");
    expect(normalizeLabel("[属性]")).toBe("attribute");
    expect(normalizeLabel("[結果]")).toBe("output");
  });

  it("英語短縮エイリアスが内部キーに正規化される", () => {
    expect(normalizeLabel("[step]")).toBe("procedure");
    expect(normalizeLabel("[mat]")).toBe("material");
    expect(normalizeLabel("[result]")).toBe("output");
    expect(normalizeLabel("[attr]")).toBe("attribute");
  });

  it("内部キーはそのまま保持される", () => {
    expect(normalizeLabel("procedure")).toBe("procedure");
    expect(normalizeLabel("material")).toBe("material");
  });

  it("エイリアスは alias として分類される", () => {
    expect(classifyLabel("[step]")).toBe("alias");
    expect(classifyLabel("[条件]")).toBe("alias");
  });

  it("[パターン] はフリーラベルとして分類される", () => {
    expect(classifyLabel("[パターン]")).toBe("free");
  });
});

// ──────────────────────────────────
// Phase B: h1 #step も Activity 化
// ──────────────────────────────────
describe("getHeadingLabelRole (Phase B)", () => {
  it("h1 #step も activity を返す（旧 section-marker は廃止）", () => {
    expect(getHeadingLabelRole(1, "procedure")).toBe("activity");
    expect(getHeadingLabelRole(2, "procedure")).toBe("activity");
    expect(getHeadingLabelRole(3, "procedure")).toBe("activity");
  });

  it("procedure 以外は null を返す", () => {
    expect(getHeadingLabelRole(2, "material")).toBeNull();
    expect(getHeadingLabelRole(2, "plan")).toBeNull();
    expect(getHeadingLabelRole(1, "free.purpose")).toBeNull();
  });
});

// `#` サジェスト（hashtag-menu）は撤去済み。工程は step ブロック、素材系ラベルは
// ドラッグハンドルのメニュー（step 内のみ）に集約したため、関連テストも削除した。
