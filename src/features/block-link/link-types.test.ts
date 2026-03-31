import { describe, it, expect } from "vitest";
import {
  LINK_TYPE_META,
  getLinkTypeLabel,
  getCreatedByLabel,
  LINK_TYPE_CONFIG,
  CREATED_BY_LABELS,
  type LinkType,
  type CreatedBy,
} from "./link-types";

// 全 6 リンクタイプ
const ALL_LINK_TYPES: LinkType[] = [
  "derived_from",
  "used",
  "generated",
  "reproduction_of",
  "informed_by",
  "reference",
];

// 全 createdBy タイプ
const ALL_CREATED_BY: CreatedBy[] = ["human", "ai", "system"];

describe("LINK_TYPE_META", () => {
  it("全 6 リンクタイプのエントリを持つ", () => {
    for (const type of ALL_LINK_TYPES) {
      expect(LINK_TYPE_META[type]).toBeDefined();
    }
    expect(Object.keys(LINK_TYPE_META)).toHaveLength(6);
  });

  it("各エントリが provDM, color, layer を持つ", () => {
    for (const type of ALL_LINK_TYPES) {
      const meta = LINK_TYPE_META[type];
      expect(meta).toHaveProperty("provDM");
      expect(meta).toHaveProperty("color");
      expect(meta).toHaveProperty("layer");
      expect(typeof meta.provDM).toBe("string");
      expect(typeof meta.color).toBe("string");
      expect(["prov", "knowledge"]).toContain(meta.layer);
    }
  });

  it("PROV 層のリンクタイプは layer が prov", () => {
    const provTypes: LinkType[] = [
      "derived_from",
      "used",
      "generated",
      "reproduction_of",
      "informed_by",
    ];
    for (const type of provTypes) {
      expect(LINK_TYPE_META[type].layer).toBe("prov");
    }
  });

  it("knowledge 層の reference は layer が knowledge", () => {
    expect(LINK_TYPE_META.reference.layer).toBe("knowledge");
  });
});

describe("getLinkTypeLabel", () => {
  it("各リンクタイプに対して空でない文字列を返す", () => {
    for (const type of ALL_LINK_TYPES) {
      const label = getLinkTypeLabel(type);
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe("getCreatedByLabel", () => {
  it("各 createdBy タイプに対して空でない文字列を返す", () => {
    for (const cb of ALL_CREATED_BY) {
      const label = getCreatedByLabel(cb);
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe("LINK_TYPE_CONFIG (Proxy)", () => {
  it('LINK_TYPE_CONFIG["used"] が label, provDM, color, layer を持つオブジェクトを返す', () => {
    const config = LINK_TYPE_CONFIG["used"];
    expect(config).toBeDefined();
    expect(config).toHaveProperty("label");
    expect(config).toHaveProperty("provDM");
    expect(config).toHaveProperty("color");
    expect(config).toHaveProperty("layer");
    expect(typeof config.label).toBe("string");
    expect(config.label.length).toBeGreaterThan(0);
    // LINK_TYPE_META の値と一致することを確認
    expect(config.provDM).toBe(LINK_TYPE_META["used"].provDM);
    expect(config.color).toBe(LINK_TYPE_META["used"].color);
    expect(config.layer).toBe(LINK_TYPE_META["used"].layer);
  });

  it("全リンクタイプで正しく動作する", () => {
    for (const type of ALL_LINK_TYPES) {
      const config = LINK_TYPE_CONFIG[type];
      expect(config).toBeDefined();
      expect(config.label).toBe(getLinkTypeLabel(type));
      expect(config.provDM).toBe(LINK_TYPE_META[type].provDM);
    }
  });

  it("存在しないキーでは undefined を返す", () => {
    // Proxy の get で meta が見つからない場合
    const result = (LINK_TYPE_CONFIG as Record<string, unknown>)["nonexistent"];
    expect(result).toBeUndefined();
  });
});

describe("CREATED_BY_LABELS (Proxy)", () => {
  it('CREATED_BY_LABELS["human"] が文字列を返す', () => {
    const label = CREATED_BY_LABELS["human"];
    expect(typeof label).toBe("string");
    expect(label.length).toBeGreaterThan(0);
  });

  it("全 createdBy タイプで正しく動作する", () => {
    for (const cb of ALL_CREATED_BY) {
      const label = CREATED_BY_LABELS[cb];
      expect(typeof label).toBe("string");
      expect(label).toBe(getCreatedByLabel(cb));
    }
  });
});
