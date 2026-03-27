import { describe, it, expect } from "vitest";
import { isProvLink, PROV_LINK_TYPES } from "./block-link/link-types";
import { buildSuggestionList, getDisplayName } from "./context-label/hashtag-menu";
import { normalizeLabel, classifyLabel, ALIAS_MAP } from "./context-label/labels";
import { generateProvDocument } from "./prov-generator/generator";

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
    // 知識層リンクは relations に含まれない
    expect(doc.relations).toHaveLength(0);
    // Activity は生成される
    expect(doc["@graph"]).toHaveLength(1);
  });
});

// ──────────────────────────────────
// 1.4 [属性] の PROV 名変更
// ──────────────────────────────────
describe("[属性] の PROV 名変更", () => {
  it("[属性] ブロックが prov:Entity として生成される", () => {
    const blocks = [
      { id: "h2-step", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "焼結" }], children: [] },
      { id: "attr-1", type: "paragraph", content: [{ type: "text", text: "温度 800℃" }], children: [] },
    ];
    const labels = new Map([["h2-step", "[手順]"], ["attr-1", "[属性]"]]);
    const doc = generateProvDocument({ blocks, labels, links: [] });

    const paramNode = doc["@graph"].find((n) => n["@id"] === "param_attr-1");
    expect(paramNode).toBeDefined();
    expect(paramNode!["@type"]).toBe("prov:Entity");
  });

  it("[属性] の関係タイプが provnote:hasAttribute になる", () => {
    const blocks = [
      { id: "h2-step", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "焼結" }], children: [] },
      { id: "attr-1", type: "paragraph", content: [{ type: "text", text: "温度 800℃" }], children: [] },
    ];
    const labels = new Map([["h2-step", "[手順]"], ["attr-1", "[属性]"]]);
    const doc = generateProvDocument({ blocks, labels, links: [] });

    const attrRels = doc.relations.filter((r) => r["@type"] === "provnote:hasAttribute");
    expect(attrRels.length).toBeGreaterThan(0);
    expect(attrRels[0].to).toBe("param_attr-1");
  });

  it("@context に provnote が含まれる", () => {
    const blocks = [
      { id: "h2-step", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "手順" }], children: [] },
    ];
    const labels = new Map([["h2-step", "[手順]"]]);
    const doc = generateProvDocument({ blocks, labels, links: [] });
    expect(doc["@context"].provnote).toBe("https://provnote.app/ns#");
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
    expect(coreItems).toHaveLength(5);
    expect(coreItems.map((s) => s.label)).toContain("[手順]");
    expect(coreItems.map((s) => s.label)).toContain("[使用したもの]");
  });

  it("候補リストにエイリアスが含まれる", () => {
    const suggestions = buildSuggestionList();
    const aliasItems = suggestions.filter((s) => s.group === "alias");
    expect(aliasItems.length).toBeGreaterThan(0);
    // エイリアスはコアラベルに正規化される
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
    expect(normalizeLabel("[sample]")).toBe("[試料]");
  });

  it("汎用化エイリアスが正規化される", () => {
    expect(normalizeLabel("[パターン]")).toBe("[試料]");
    expect(normalizeLabel("[ケース]")).toBe("[試料]");
    expect(normalizeLabel("[条件群]")).toBe("[試料]");
  });

  it("エイリアスは alias として分類される", () => {
    expect(classifyLabel("[step]")).toBe("alias");
    expect(classifyLabel("[パターン]")).toBe("alias");
  });
});
