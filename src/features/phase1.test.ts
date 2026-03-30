import { describe, it, expect } from "vitest";
import { isProvLink, PROV_LINK_TYPES } from "./block-link/link-types";
import { buildSuggestionList, getDisplayName } from "./context-label/hashtag-menu";
import { normalizeLabel, classifyLabel, ALIAS_MAP } from "./context-label/labels";
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
    const labels = new Map([["h2-step", "[手順]"]]);
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
// 1.4 [属性] の PROV 名変更
// ──────────────────────────────────
describe("[属性] の PROV 名変更", () => {
  it("[属性] ブロックが独立ノードではなく親の provnote:attributes に埋め込まれる", () => {
    const blocks = [
      { id: "h2-step", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "焼結" }], children: [] },
      { id: "attr-1", type: "paragraph", content: [{ type: "text", text: "温度 800℃" }], children: [] },
    ];
    const labels = new Map([["h2-step", "[手順]"], ["attr-1", "[属性]"]]);
    const doc = generateProvDocument({ blocks, labels, links: [] });

    // param_ ノードは生成されない
    const paramNode = doc["@graph"].find((n) => n["@id"] === "param_attr-1");
    expect(paramNode).toBeUndefined();
    // Activity に埋め込み
    const act = doc["@graph"].find((n) => n["@id"] === "activity_h2-step");
    expect(act?.["provnote:attributes"]).toHaveLength(1);
    expect(act!["provnote:attributes"]![0]["rdfs:label"]).toBe("温度 800℃");
  });

  it("[属性] が親 Activity の provnote:attributes に埋め込まれる", () => {
    const blocks = [
      { id: "h2-step", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "焼結" }], children: [] },
      { id: "attr-1", type: "paragraph", content: [{ type: "text", text: "温度 800℃" }], children: [] },
    ];
    const labels = new Map([["h2-step", "[手順]"], ["attr-1", "[属性]"]]);
    const doc = generateProvDocument({ blocks, labels, links: [] });

    // param_ ノードは生成されない
    expect(doc["@graph"].filter((n) => n["@id"].startsWith("param_"))).toHaveLength(0);
    // Activity に属性が埋め込まれている
    const act = doc["@graph"].find((n) => n["@id"] === "activity_h2-step");
    expect(act?.["provnote:attributes"]).toBeDefined();
    expect(act!["provnote:attributes"]![0]["rdfs:label"]).toBe("温度 800℃");
  });

  it("@context に provnote, rdfs, xsd が含まれる", () => {
    const blocks = [
      { id: "h2-step", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "手順" }], children: [] },
    ];
    const labels = new Map([["h2-step", "[手順]"]]);
    const doc = generateProvDocument({ blocks, labels, links: [] });
    expect(doc["@context"].provnote).toBe("https://provnote.app/ns#");
    expect(doc["@context"].rdfs).toBe("http://www.w3.org/2000/01/rdf-schema#");
    expect(doc["@context"].xsd).toBe("http://www.w3.org/2001/XMLSchema#");
    expect((doc["@context"] as any).matprov).toBeUndefined();
  });
});

// ──────────────────────────────────
// 1.1 # オートコンプリート
// ──────────────────────────────────
describe("# オートコンプリート候補", () => {
  it("候補リストにコアラベルが含まれる", () => {
    const suggestions = buildSuggestionList();
    const coreItems = suggestions.filter((s) => s.group === "core");
    expect(coreItems).toHaveLength(4);
    expect(coreItems.map((s) => s.label)).toContain("[手順]");
    expect(coreItems.map((s) => s.label)).toContain("[使用したもの]");
  });

  it("候補リストにエイリアスが含まれる", () => {
    const suggestions = buildSuggestionList();
    const aliasItems = suggestions.filter((s) => s.group === "alias");
    expect(aliasItems.length).toBeGreaterThan(0);
    const matAlias = aliasItems.find((s) => s.query === "材料");
    expect(matAlias?.label).toBe("[使用したもの]");
  });

  it("候補リストにフリーラベルが含まれる", () => {
    const suggestions = buildSuggestionList();
    const freeItems = suggestions.filter((s) => s.group === "free");
    expect(freeItems.length).toBeGreaterThan(0);
  });

  it("getDisplayName は [] を除去する", () => {
    expect(getDisplayName("[手順]")).toBe("手順");
    expect(getDisplayName("[使用したもの]")).toBe("使用したもの");
    expect(getDisplayName("[カスタム]")).toBe("カスタム");
  });
});

// ──────────────────────────────────
// ラベルの追加エイリアス
// ──────────────────────────────────
describe("ラベルエイリアス拡張", () => {
  it("英語短縮エイリアスが正規化される", () => {
    expect(normalizeLabel("[step]")).toBe("[手順]");
    expect(normalizeLabel("[mat]")).toBe("[使用したもの]");
    expect(normalizeLabel("[result]")).toBe("[結果]");
    expect(normalizeLabel("[attr]")).toBe("[属性]");
  });

  it("エイリアスは alias として分類される", () => {
    expect(classifyLabel("[step]")).toBe("alias");
    expect(classifyLabel("[条件]")).toBe("alias");
  });

  it("[パターン] は廃止されフリーラベルとして分類される", () => {
    expect(classifyLabel("[パターン]")).toBe("free");
  });
});
