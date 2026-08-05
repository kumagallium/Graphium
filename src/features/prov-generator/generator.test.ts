import { describe, it, expect } from "vitest";
import { generateProvDocument, extractRelations, parseStructuredTable, parseParameterTable } from "./generator";

// ── ヘルパー: ProvJsonLd から関係をフラットに取得 ──
function getRelations(doc: ReturnType<typeof generateProvDocument>) {
  return extractRelations(doc);
}

function getWarnings(doc: ReturnType<typeof generateProvDocument>) {
  return doc["graphium:warnings"] ?? [];
}

// ──────────────────────────────────
// シナリオ 1: カレー実験（基本形）
// ──────────────────────────────────

const curryBlocks = [
  {
    id: "h2-cut",
    type: "heading",
    props: { level: 2 },
    content: [{ type: "text", text: "1. 具材を切る" }],
    children: [],
  },
  {
    id: "used-vegs",
    type: "paragraph",
    content: [{ type: "text", text: "にんじん、じゃがいも" }],
    children: [],
  },
  {
    id: "h2-fry",
    type: "heading",
    props: { level: 2 },
    content: [{ type: "text", text: "2. 炒める" }],
    children: [],
  },
  {
    id: "cond-fire",
    type: "paragraph",
    content: [{ type: "text", text: "中火 5分" }],
    children: [],
  },
  {
    id: "h2-simmer",
    type: "heading",
    props: { level: 2 },
    content: [{ type: "text", text: "3. 煮込む" }],
    children: [],
  },
  {
    id: "result-curry",
    type: "paragraph",
    content: [{ type: "text", text: "カレー完成" }],
    children: [],
  },
];

const curryLabels = new Map([
  ["h2-cut", "procedure"],
  ["used-vegs", "material"],
  ["h2-fry", "procedure"],
  ["cond-fire", "attribute"],
  ["h2-simmer", "procedure"],
  ["result-curry", "output"],
]);

const curryLinks = [
  { id: "link-1", sourceBlockId: "h2-fry", targetBlockId: "h2-cut", type: "informed_by" as const, layer: "prov" as const, createdBy: "human" as const },
  { id: "link-2", sourceBlockId: "h2-simmer", targetBlockId: "h2-fry", type: "informed_by" as const, layer: "prov" as const, createdBy: "human" as const },
];

describe("カレー実験シナリオ（基本形）", () => {
  it("3つのActivityが生成される", () => {
    const doc = generateProvDocument({ blocks: curryBlocks, labels: curryLabels, links: curryLinks });
    const activities = doc["@graph"].filter((n) => n["@type"] === "prov:Activity");
    expect(activities).toHaveLength(3);
    // 見出しの連番プレフィックスは activity 名から除かれる（deriveActivityName）
    expect(activities.map((a) => a["rdfs:label"])).toEqual([
      "具材を切る",
      "炒める",
      "煮込む",
    ]);
  });

  it("[使用したもの] が Entity として生成される", () => {
    const doc = generateProvDocument({ blocks: curryBlocks, labels: curryLabels, links: curryLinks });
    const entities = doc["@graph"].filter((n) => n["@type"] === "prov:Entity");
    expect(entities.some((e) => e["rdfs:label"] === "にんじん、じゃがいも")).toBe(true);
  });

  it("[属性] が親ノード（Activity）の graphium:attributes に埋め込まれる", () => {
    const doc = generateProvDocument({ blocks: curryBlocks, labels: curryLabels, links: curryLinks });
    // param_ ノードは生成されない
    const params = doc["@graph"].filter((n) => n["@id"].startsWith("param_"));
    expect(params).toHaveLength(0);
    // 「炒める」Activity に属性が埋め込まれている
    const fryAct = doc["@graph"].find((n) => n["@id"] === "activity_h2-fry");
    expect(fryAct?.["graphium:attributes"]).toBeDefined();
    expect(fryAct!["graphium:attributes"]).toHaveLength(1);
    expect(fryAct!["graphium:attributes"]![0]["rdfs:label"]).toBe("中火 5分");
  });

  it("[結果] が Entity として生成される", () => {
    const doc = generateProvDocument({ blocks: curryBlocks, labels: curryLabels, links: curryLinks });
    const entities = doc["@graph"].filter((n) => n["@type"] === "prov:Entity");
    expect(entities.some((e) => e["rdfs:label"] === "カレー完成")).toBe(true);
  });

  it("前手順リンクが結果Entity経由の used として生成される", () => {
    const doc = generateProvDocument({ blocks: curryBlocks, labels: curryLabels, links: curryLinks });
    const relations = getRelations(doc);
    const usedRels = relations.filter((r) => r["@type"] === "prov:used");
    // [使用したもの] の used 1つ + 前手順リンク由来の used 2つ
    expect(usedRels.length).toBeGreaterThanOrEqual(3);
  });

  it("警告が出ない", () => {
    const doc = generateProvDocument({ blocks: curryBlocks, labels: curryLabels, links: curryLinks });
    expect(getWarnings(doc)).toHaveLength(0);
  });

  it("@context に rdfs と xsd が含まれる", () => {
    const doc = generateProvDocument({ blocks: curryBlocks, labels: curryLabels, links: curryLinks });
    expect(doc["@context"].rdfs).toBe("http://www.w3.org/2000/01/rdf-schema#");
    expect(doc["@context"].xsd).toBe("http://www.w3.org/2001/XMLSchema#");
  });

  it("ノードに rdfs:label と graphium:blockId が含まれる", () => {
    const doc = generateProvDocument({ blocks: curryBlocks, labels: curryLabels, links: curryLinks });
    for (const node of doc["@graph"]) {
      expect(node["rdfs:label"]).toBeDefined();
      expect(node["graphium:blockId"]).toBeDefined();
    }
  });

  it("関係がノードに埋め込まれている（トップレベルの relations がない）", () => {
    const doc = generateProvDocument({ blocks: curryBlocks, labels: curryLabels, links: curryLinks });
    expect((doc as any).relations).toBeUndefined();
    const actCut = doc["@graph"].find((n) => n["@id"] === "activity_h2-cut");
    expect(actCut?.["prov:used"]).toBeDefined();
    // 属性は graphium:attributes として埋め込み（hasAttribute リレーションなし）
    const relations = getRelations(doc);
    const attrRels = relations.filter((r) => r["@type"] === "graphium:hasAttribute");
    expect(attrRels).toHaveLength(0);
  });
});

// ──────────────────────────────────
// シナリオ 1.5: スコープ境界テスト
// ──────────────────────────────────

const scopeBlocks = [
  {
    id: "h2-cut",
    type: "heading",
    props: { level: 2 },
    content: [{ type: "text", text: "1. 具材を切る" }],
    children: [],
  },
  {
    id: "used-carrot",
    type: "paragraph",
    content: [{ type: "text", text: "にんじん" }],
    children: [],
  },
  {
    id: "h2-note",
    type: "heading",
    props: { level: 2 },
    content: [{ type: "text", text: "補足事項" }],
    children: [],
  },
  {
    id: "used-memo",
    type: "paragraph",
    content: [{ type: "text", text: "メモ" }],
    children: [],
  },
  {
    id: "h2-fry",
    type: "heading",
    props: { level: 2 },
    content: [{ type: "text", text: "2. 炒める" }],
    children: [],
  },
  {
    id: "cond-fire",
    type: "paragraph",
    content: [{ type: "text", text: "中火" }],
    children: [],
  },
];

const scopeLabels = new Map([
  ["h2-cut", "procedure"],
  ["used-carrot", "material"],
  ["used-memo", "material"],
  ["h2-fry", "procedure"],
  ["cond-fire", "attribute"],
]);

describe("スコープ境界テスト", () => {
  it("ラベルなしH2がスコープを切る — [使用したもの] が前のActivityに紐づかない", () => {
    const doc = generateProvDocument({ blocks: scopeBlocks, labels: scopeLabels, links: [] });
    const relations = getRelations(doc);

    const carrotUsed = relations.filter(
      (r) => r["@type"] === "prov:used" && r.to === "entity_used-carrot"
    );
    expect(carrotUsed).toHaveLength(1);
    expect(carrotUsed[0].from).toBe("activity_h2-cut");

    const memoUsed = relations.filter(
      (r) => r["@type"] === "prov:used" && r.to === "entity_used-memo"
    );
    expect(memoUsed).toHaveLength(0);
  });

  it("[属性] は新しいH2 [手順] のスコープに埋め込まれる", () => {
    const doc = generateProvDocument({ blocks: scopeBlocks, labels: scopeLabels, links: [] });
    // 「炒める」Activity に属性が埋め込まれている
    const fryAct = doc["@graph"].find((n) => n["@id"] === "activity_h2-fry");
    expect(fryAct?.["graphium:attributes"]).toBeDefined();
    expect(fryAct!["graphium:attributes"]!.some((a: any) => a["rdfs:label"] === "中火")).toBe(true);
  });

  it("H1がスコープをリセットする", () => {
    const blocksWithH1 = [
      {
        id: "h2-step",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "ステップ" }],
        children: [],
      },
      {
        id: "used-item",
        type: "paragraph",
        content: [{ type: "text", text: "アイテム" }],
        children: [],
      },
      {
        id: "h1-section",
        type: "heading",
        props: { level: 1 },
        content: [{ type: "text", text: "新セクション" }],
        children: [],
      },
      {
        id: "used-orphan",
        type: "paragraph",
        content: [{ type: "text", text: "孤立アイテム" }],
        children: [],
      },
    ];
    const labelsWithH1 = new Map([
      ["h2-step", "procedure"],
      ["used-item", "material"],
      ["used-orphan", "material"],
    ]);

    const doc = generateProvDocument({ blocks: blocksWithH1, labels: labelsWithH1, links: [] });
    const relations = getRelations(doc);

    const orphanUsed = relations.filter(
      (r) => r["@type"] === "prov:used" && r.to === "entity_used-orphan"
    );
    expect(orphanUsed).toHaveLength(0);
  });

  it("ラベルなしH3は親H2スコープを維持する", () => {
    const blocksWithH3 = [
      {
        id: "h2-step",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "ステップ" }],
        children: [],
      },
      {
        id: "h3-detail",
        type: "heading",
        props: { level: 3 },
        content: [{ type: "text", text: "詳細" }],
        children: [],
      },
      {
        id: "used-detail-item",
        type: "paragraph",
        content: [{ type: "text", text: "詳細アイテム" }],
        children: [],
      },
    ];
    const labelsWithH3 = new Map([
      ["h2-step", "procedure"],
      ["used-detail-item", "material"],
    ]);

    const doc = generateProvDocument({ blocks: blocksWithH3, labels: labelsWithH3, links: [] });
    const relations = getRelations(doc);

    const detailUsed = relations.filter(
      (r) => r["@type"] === "prov:used" && r.to === "entity_used-detail-item"
    );
    expect(detailUsed).toHaveLength(1);
    expect(detailUsed[0].from).toBe("activity_h2-step");
  });
});

// ──────────────────────────────────
// シナリオ 3: 見出しレベル階層スコープ
// ──────────────────────────────────

const hierarchyBlocks = [
  {
    id: "h2-a",
    type: "heading",
    props: { level: 2 },
    content: [{ type: "text", text: "Step A" }],
    children: [],
  },
  {
    id: "used-mat1",
    type: "paragraph",
    content: [{ type: "text", text: "Material 1" }],
    children: [],
  },
  {
    id: "h3-a1",
    type: "heading",
    props: { level: 3 },
    content: [{ type: "text", text: "Sub-step A.1" }],
    children: [],
  },
  {
    id: "used-mat2",
    type: "paragraph",
    content: [{ type: "text", text: "Material 2" }],
    children: [],
  },
  {
    id: "result-a1",
    type: "paragraph",
    content: [{ type: "text", text: "Result A.1" }],
    children: [],
  },
  {
    id: "h3-a2",
    type: "heading",
    props: { level: 3 },
    content: [{ type: "text", text: "Sub-step A.2" }],
    children: [],
  },
  {
    id: "param-a2",
    type: "paragraph",
    content: [{ type: "text", text: "Param A.2" }],
    children: [],
  },
  {
    id: "result-a2",
    type: "paragraph",
    content: [{ type: "text", text: "Result A.2" }],
    children: [],
  },
  {
    id: "h2-b",
    type: "heading",
    props: { level: 2 },
    content: [{ type: "text", text: "Step B" }],
    children: [],
  },
  {
    id: "used-mat3",
    type: "paragraph",
    content: [{ type: "text", text: "Material 3" }],
    children: [],
  },
];

const hierarchyLabels = new Map([
  ["h2-a", "procedure"],
  ["used-mat1", "material"],
  ["h3-a1", "procedure"],
  ["used-mat2", "material"],
  ["result-a1", "output"],
  ["h3-a2", "procedure"],
  ["param-a2", "attribute"],
  ["result-a2", "output"],
  ["h2-b", "procedure"],
  ["used-mat3", "material"],
]);

describe("見出しレベル階層スコープ", () => {
  it("H2とH3の両方がActivityを生成する", () => {
    const doc = generateProvDocument({ blocks: hierarchyBlocks, labels: hierarchyLabels, links: [] });
    const activities = doc["@graph"].filter((n) => n["@type"] === "prov:Activity");
    expect(activities).toHaveLength(4);
    expect(activities.map((a) => a["rdfs:label"])).toEqual([
      "Step A",
      "Sub-step A.1",
      "Sub-step A.2",
      "Step B",
    ]);
  });

  it("H2直下の [使用したもの] は H2 Activity にスコープされる", () => {
    const doc = generateProvDocument({ blocks: hierarchyBlocks, labels: hierarchyLabels, links: [] });
    const relations = getRelations(doc);
    const mat1Used = relations.filter(
      (r) => r["@type"] === "prov:used" && r.to === "entity_used-mat1"
    );
    expect(mat1Used).toHaveLength(1);
    expect(mat1Used[0].from).toBe("activity_h2-a");
  });

  it("H3直下の [使用したもの] は H3 サブActivity にスコープされる", () => {
    const doc = generateProvDocument({ blocks: hierarchyBlocks, labels: hierarchyLabels, links: [] });
    const relations = getRelations(doc);
    const mat2Used = relations.filter(
      (r) => r["@type"] === "prov:used" && r.to === "entity_used-mat2"
    );
    expect(mat2Used).toHaveLength(1);
    expect(mat2Used[0].from).toBe("activity_h3-a1");
  });

  it("[結果] は対応するH3サブActivityにスコープされる", () => {
    const doc = generateProvDocument({ blocks: hierarchyBlocks, labels: hierarchyLabels, links: [] });
    const relations = getRelations(doc);
    const resultA1 = relations.filter(
      (r) => r["@type"] === "prov:wasGeneratedBy" && r.from === "result_result-a1"
    );
    expect(resultA1).toHaveLength(1);
    expect(resultA1[0].to).toBe("activity_h3-a1");

    const resultA2 = relations.filter(
      (r) => r["@type"] === "prov:wasGeneratedBy" && r.from === "result_result-a2"
    );
    expect(resultA2).toHaveLength(1);
    expect(resultA2[0].to).toBe("activity_h3-a2");
  });

  it("[属性] は H3 サブActivity の graphium:attributes に埋め込まれる", () => {
    const doc = generateProvDocument({ blocks: hierarchyBlocks, labels: hierarchyLabels, links: [] });
    const a2Act = doc["@graph"].find((n) => n["@id"] === "activity_h3-a2");
    expect(a2Act?.["graphium:attributes"]).toBeDefined();
    expect(a2Act!["graphium:attributes"]!.some((a: any) => a["rdfs:label"] === "Param A.2")).toBe(true);
  });

  it("次のH2で全スコープがリセットされる", () => {
    const doc = generateProvDocument({ blocks: hierarchyBlocks, labels: hierarchyLabels, links: [] });
    const relations = getRelations(doc);
    const mat3Used = relations.filter(
      (r) => r["@type"] === "prov:used" && r.to === "entity_used-mat3"
    );
    expect(mat3Used).toHaveLength(1);
    expect(mat3Used[0].from).toBe("activity_h2-b");
  });

  it("ラベルなしH3がサブActivityスコープを閉じて親H2に戻る", () => {
    const blocksWithUnlabeledH3 = [
      {
        id: "h2-parent",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "親ステップ" }],
        children: [],
      },
      {
        id: "h3-sub",
        type: "heading",
        props: { level: 3 },
        content: [{ type: "text", text: "サブステップ" }],
        children: [],
      },
      {
        id: "used-in-sub",
        type: "paragraph",
        content: [{ type: "text", text: "サブの材料" }],
        children: [],
      },
      {
        id: "h3-note",
        type: "heading",
        props: { level: 3 },
        content: [{ type: "text", text: "補足" }],
        children: [],
      },
      {
        id: "used-after-note",
        type: "paragraph",
        content: [{ type: "text", text: "補足後の材料" }],
        children: [],
      },
    ];
    const labelsWithUnlabeledH3 = new Map([
      ["h2-parent", "procedure"],
      ["h3-sub", "procedure"],
      ["used-in-sub", "material"],
      ["used-after-note", "material"],
    ]);

    const doc = generateProvDocument({ blocks: blocksWithUnlabeledH3, labels: labelsWithUnlabeledH3, links: [] });
    const relations = getRelations(doc);

    const subUsed = relations.filter(
      (r) => r["@type"] === "prov:used" && r.to === "entity_used-in-sub"
    );
    expect(subUsed).toHaveLength(1);
    expect(subUsed[0].from).toBe("activity_h3-sub");

    const afterNoteUsed = relations.filter(
      (r) => r["@type"] === "prov:used" && r.to === "entity_used-after-note"
    );
    expect(afterNoteUsed).toHaveLength(1);
    expect(afterNoteUsed[0].from).toBe("activity_h2-parent");
  });
});


// ──────────────────────────────────
// Phase 3: テーブル構造化属性
// ──────────────────────────────────

describe("Phase 3: テーブル構造化属性", () => {
  it("[使用したもの] テーブルの行が個別 Entity に展開される", () => {
    const blocks = [
      {
        id: "h2-mix",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "混合する" }],
        children: [],
      },
      {
        id: "mat-table",
        type: "table",
        content: {
          type: "tableContent",
          rows: [
            { cells: [[{ type: "text", text: "名前" }], [{ type: "text", text: "量" }], [{ type: "text", text: "純度" }]] },
            { cells: [[{ type: "text", text: "Cu粉末" }], [{ type: "text", text: "1g" }], [{ type: "text", text: "99.9%" }]] },
            { cells: [[{ type: "text", text: "Zn粉末" }], [{ type: "text", text: "0.5g" }], [{ type: "text", text: "99.5%" }]] },
          ],
        },
        children: [],
      },
    ];
    const labels = new Map([
      ["h2-mix", "procedure"],
      ["mat-table", "material"],
    ]);

    const doc = generateProvDocument({ blocks, labels, links: [] });

    // 2行 → 2つの Entity
    const cuEntity = doc["@graph"].find((n) => n["@id"] === "entity_mat-table_Cu粉末");
    expect(cuEntity).toBeDefined();
    expect(cuEntity!["rdfs:label"]).toBe("Cu粉末");
    expect(cuEntity!["graphium:量"]).toBe("1g");
    expect(cuEntity!["graphium:純度"]).toBe("99.9%");

    const znEntity = doc["@graph"].find((n) => n["@id"] === "entity_mat-table_Zn粉末");
    expect(znEntity).toBeDefined();
    expect(znEntity!["graphium:量"]).toBe("0.5g");

    // used 関係（Activity → Entity）
    const relations = getRelations(doc);
    const usedCu = relations.filter((r) => r.to === "entity_mat-table_Cu粉末" && r["@type"] === "prov:used");
    expect(usedCu).toHaveLength(1);
    expect(usedCu[0].from).toBe("activity_h2-mix");
  });

  it("同名行が衝突せず別 Entity になる（@id 衝突回避 / M6）", () => {
    const blocks = [
      {
        id: "h2-mix",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "混合する" }],
        children: [],
      },
      {
        id: "dup-table",
        type: "table",
        content: {
          type: "tableContent",
          rows: [
            { cells: [[{ type: "text", text: "名前" }], [{ type: "text", text: "量" }]] },
            { cells: [[{ type: "text", text: "Cu" }], [{ type: "text", text: "1g" }]] },
            { cells: [[{ type: "text", text: "Cu" }], [{ type: "text", text: "2g" }]] },
          ],
        },
        children: [],
      },
    ];
    const labels = new Map([
      ["h2-mix", "procedure"],
      ["dup-table", "material"],
    ]);

    const doc = generateProvDocument({ blocks, labels, links: [] });

    // 同名 2 行 → 衝突せず 2 つの別 Entity（初出は従来形式、2 件目は連番）
    const first = doc["@graph"].find((n) => n["@id"] === "entity_dup-table_Cu");
    const second = doc["@graph"].find((n) => n["@id"] === "entity_dup-table_Cu_2");
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // それぞれの params が独立して保持される（上書きで消えない）
    expect(first!["graphium:量"]).toBe("1g");
    expect(second!["graphium:量"]).toBe("2g");
    // used 関係も 2 本（行ごとに別 Entity）
    const relations = getRelations(doc);
    const usedCu = relations.filter(
      (r) => (r.to === "entity_dup-table_Cu" || r.to === "entity_dup-table_Cu_2") && r["@type"] === "prov:used",
    );
    expect(usedCu).toHaveLength(2);
  });

  it("[結果] テーブルの行が個別 Entity に展開される", () => {
    const blocks = [
      {
        id: "h2-eval",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "評価する" }],
        children: [],
      },
      {
        id: "res-table",
        type: "table",
        content: {
          type: "tableContent",
          rows: [
            { cells: [[{ type: "text", text: "項目" }], [{ type: "text", text: "値" }]] },
            { cells: [[{ type: "text", text: "密度" }], [{ type: "text", text: "8.96 g/cm³" }]] },
            { cells: [[{ type: "text", text: "硬度" }], [{ type: "text", text: "HV 120" }]] },
          ],
        },
        children: [],
      },
    ];
    const labels = new Map([
      ["h2-eval", "procedure"],
      ["res-table", "output"],
    ]);

    const doc = generateProvDocument({ blocks, labels, links: [] });

    const densityEntity = doc["@graph"].find((n) => n["@id"] === "result_res-table_密度");
    expect(densityEntity).toBeDefined();
    expect(densityEntity!["rdfs:label"]).toBe("密度");
    expect(densityEntity!["graphium:値"]).toBe("8.96 g/cm³");

    // wasGeneratedBy 関係
    const relations = getRelations(doc);
    const genRels = relations.filter((r) => r.from === "result_res-table_密度" && r["@type"] === "prov:wasGeneratedBy");
    expect(genRels).toHaveLength(1);
    expect(genRels[0].to).toBe("activity_h2-eval");
  });

  it("段落ブロックの [使用したもの] は従来通り1つの Entity になる", () => {
    const blocks = [
      {
        id: "h2-step",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "手順" }],
        children: [],
      },
      {
        id: "used-para",
        type: "paragraph",
        content: [{ type: "text", text: "Cu粉末 1g" }],
        children: [],
      },
    ];
    const labels = new Map([
      ["h2-step", "procedure"],
      ["used-para", "material"],
    ]);

    const doc = generateProvDocument({ blocks, labels, links: [] });
    const entity = doc["@graph"].find((n) => n["@id"] === "entity_used-para");
    expect(entity).toBeDefined();
    expect(entity!["rdfs:label"]).toBe("Cu粉末 1g");
  });

  it("[材料] テーブルの直後に置いた無関係な画像は Entity 化しない（メディア文脈リーク防止）", () => {
    // 構造テーブルの material ラベルは自己完結（行が Entity）であり、
    // 後続のメディアブロックへ entity 文脈を流してはいけない。
    const blocks = [
      {
        id: "h2-mix",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "混合する" }],
        children: [],
      },
      {
        id: "mat-table",
        type: "table",
        content: {
          type: "tableContent",
          rows: [
            { cells: [[{ type: "text", text: "名前" }], [{ type: "text", text: "量" }]] },
            { cells: [[{ type: "text", text: "Cu粉末" }], [{ type: "text", text: "1g" }]] },
          ],
        },
        children: [],
      },
      {
        id: "img-micro",
        type: "image",
        props: { url: "https://example.com/microstructure.png", name: "microstructure.png" },
        children: [],
      },
    ];
    const labels = new Map([
      ["h2-mix", "procedure"],
      ["mat-table", "material"],
    ]);

    const doc = generateProvDocument({ blocks, labels, links: [] });

    // テーブル行は Entity 化される
    expect(doc["@graph"].find((n) => n["@id"] === "entity_mat-table_Cu粉末")).toBeDefined();
    // 直後の画像は Entity 化されない（material 文脈がリークしない）
    expect(doc["@graph"].find((n) => n["@id"] === "entity_media_img-micro")).toBeUndefined();
    expect(doc["@graph"].find((n) => n["@id"] === "result_media_img-micro")).toBeUndefined();
  });

  it("[パラメータ] テーブルが手順（Activity）の params に展開される", () => {
    const blocks = [
      {
        id: "h2-sinter",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "焼成する" }],
        children: [],
      },
      {
        id: "param-table",
        type: "table",
        content: {
          type: "tableContent",
          rows: [
            { cells: [[{ type: "text", text: "温度" }], [{ type: "text", text: "時間" }], [{ type: "text", text: "圧力" }]] },
            { cells: [[{ type: "text", text: "800℃" }], [{ type: "text", text: "2h" }], [{ type: "text", text: "1atm" }]] },
          ],
        },
        children: [],
      },
    ];
    const labels = new Map([
      ["h2-sinter", "procedure"],
      ["param-table", "attribute"],
    ]);

    const doc = generateProvDocument({ blocks, labels, links: [] });

    // 手順の Activity ノードに params が key=value で埋め込まれる
    const act = doc["@graph"].find((n) => n["@id"] === "activity_h2-sinter");
    expect(act).toBeDefined();
    expect(act!["graphium:温度"]).toBe("800℃");
    expect(act!["graphium:時間"]).toBe("2h");
    expect(act!["graphium:圧力"]).toBe("1atm");

    // パラメータテーブル自体は独立ノードにならない（id だけのノードを作らない）
    expect(doc["@graph"].find((n) => n["@id"] === "entity_param-table")).toBeUndefined();
    expect(doc["@graph"].some((n) => n["@id"]?.includes("param-table") && n["@type"] === "prov:Entity")).toBe(false);
  });
});

describe("parseParameterTable", () => {
  it("ヘッダー=key、先頭データ行=value で Record 化する", () => {
    const block = {
      type: "table",
      content: {
        type: "tableContent",
        rows: [
          { cells: [[{ type: "text", text: "温度" }], [{ type: "text", text: "時間" }]] },
          { cells: [[{ type: "text", text: "800℃" }], [{ type: "text", text: "2h" }]] },
        ],
      },
    };
    expect(parseParameterTable(block)).toEqual({ 温度: "800℃", 時間: "2h" });
  });

  it("テーブル以外・行不足・空セルは null / 除外する", () => {
    expect(parseParameterTable({ type: "paragraph" })).toBeNull();
    expect(parseParameterTable({ type: "table", content: { type: "tableContent", rows: [{ cells: [[{ type: "text", text: "温度" }]] }] } })).toBeNull();
    // key はあるが value が空 → 除外され、結果が空なら null
    expect(parseParameterTable({
      type: "table",
      content: { type: "tableContent", rows: [
        { cells: [[{ type: "text", text: "温度" }]] },
        { cells: [[{ type: "text", text: "" }]] },
      ] },
    })).toBeNull();
  });
});

// ──────────────────────────────────
// Phase 3: parseStructuredTable 単体テスト
// ──────────────────────────────────

describe("parseStructuredTable", () => {
  it("テーブルをヘッダー=key、セル=value で構造化する", () => {
    const block = {
      type: "table",
      content: {
        rows: [
          { cells: [[{ type: "text", text: "名前" }], [{ type: "text", text: "量" }]] },
          { cells: [[{ type: "text", text: "Cu" }], [{ type: "text", text: "1g" }]] },
          { cells: [[{ type: "text", text: "Zn" }], [{ type: "text", text: "0.5g" }]] },
        ],
      },
    };

    const result = parseStructuredTable(block);
    expect(result).not.toBeNull();
    expect(result!.rows).toHaveLength(2);
    expect(result!.rows[0]).toEqual({ name: "Cu", attrs: { "量": "1g" } });
    expect(result!.rows[1]).toEqual({ name: "Zn", attrs: { "量": "0.5g" } });
  });

  it("テーブル以外のブロックは null を返す", () => {
    expect(parseStructuredTable({ type: "paragraph" })).toBeNull();
  });

  it("ヘッダーだけのテーブルは null を返す", () => {
    const block = {
      type: "table",
      content: {
        rows: [
          { cells: [[{ type: "text", text: "名前" }]] },
        ],
      },
    };
    expect(parseStructuredTable(block)).toBeNull();
  });
});

// ──────────────────────────────────
// Phase 3: extractRelations ユーティリティ
// ──────────────────────────────────

describe("extractRelations", () => {
  it("埋め込み関係をフラットなリストに展開する", () => {
    const doc = generateProvDocument({
      blocks: curryBlocks,
      labels: curryLabels,
      links: curryLinks,
    });
    const relations = extractRelations(doc);
    expect(relations.length).toBeGreaterThan(0);

    // used, wasGeneratedBy が含まれる（hasAttribute は廃止 — 属性は埋め込み）
    const types = new Set(relations.map((r) => r["@type"]));
    expect(types.has("prov:used")).toBe(true);
    expect(types.has("prov:wasGeneratedBy")).toBe(true);
    expect(types.has("graphium:hasAttribute")).toBe(false);
  });
});

// ──────────────────────────────────
// 孤立リンクのクリーンアップ
// ──────────────────────────────────

describe("孤立リンク（G-ORPHAN-LINK）", () => {
  it("削除済みブロックへの informed_by リンクは合成Entity を生成しない", () => {
    // h2-cut → h2-fry のリンクがあるが、h2-cut は削除済み（blocks に含まれない）
    const blocksWithoutCut = curryBlocks.filter((b) => b.id !== "h2-cut" && b.id !== "used-vegs");
    const labelsWithoutCut = new Map([
      ["h2-fry", "procedure"],
      ["cond-fire", "attribute"],
      ["h2-simmer", "procedure"],
      ["result-curry", "output"],
    ]);
    const linksWithOrphan = [
      { id: "link-1", sourceBlockId: "h2-fry", targetBlockId: "h2-cut", type: "informed_by" as const, layer: "prov" as const, createdBy: "human" as const },
      { id: "link-2", sourceBlockId: "h2-simmer", targetBlockId: "h2-fry", type: "informed_by" as const, layer: "prov" as const, createdBy: "human" as const },
    ];

    const doc = generateProvDocument({ blocks: blocksWithoutCut, labels: labelsWithoutCut, links: linksWithOrphan });

    // 削除済みブロック（h2-cut）の合成 Entity が生成されていないこと
    const orphanSynthetic = doc["@graph"].filter((n) => n["@id"] === "result_synthetic_h2-cut");
    expect(orphanSynthetic).toHaveLength(0);

    // 削除済みブロック参照のノードが存在しないこと
    const orphanNodes = doc["@graph"].filter((n) => n["graphium:blockId"] === "h2-cut");
    expect(orphanNodes).toHaveLength(0);

    // 有効なリンク（h2-simmer → h2-fry）の合成 Entity は正常に生成されること
    const validSynthetic = doc["@graph"].filter((n) => n["@id"] === "result_synthetic_h2-fry");
    expect(validSynthetic).toHaveLength(1);
  });

  it("削除済みブロックへのリンクに broken-link 警告が出る", () => {
    const blocksWithoutCut = curryBlocks.filter((b) => b.id !== "h2-cut" && b.id !== "used-vegs");
    const labelsWithoutCut = new Map([
      ["h2-fry", "procedure"],
      ["cond-fire", "attribute"],
      ["h2-simmer", "procedure"],
      ["result-curry", "output"],
    ]);
    const linksWithOrphan = [
      { id: "link-1", sourceBlockId: "h2-fry", targetBlockId: "h2-cut", type: "informed_by" as const, layer: "prov" as const, createdBy: "human" as const },
    ];

    const doc = generateProvDocument({ blocks: blocksWithoutCut, labels: labelsWithoutCut, links: linksWithOrphan });
    const warnings = getWarnings(doc);

    expect(warnings.some((w: any) => w.type === "broken-link")).toBe(true);
  });

  it("ソースブロックが削除済みのリンクもスキップされる", () => {
    // h2-fry が削除されたが、h2-fry → h2-cut のリンクが残っている場合
    const blocksWithoutFry = curryBlocks.filter((b) => b.id !== "h2-fry" && b.id !== "cond-fire");
    const labelsWithoutFry = new Map([
      ["h2-cut", "procedure"],
      ["used-vegs", "material"],
      ["h2-simmer", "procedure"],
      ["result-curry", "output"],
    ]);
    const linksWithOrphanSource = [
      { id: "link-1", sourceBlockId: "h2-fry", targetBlockId: "h2-cut", type: "informed_by" as const, layer: "prov" as const, createdBy: "human" as const },
    ];

    const doc = generateProvDocument({ blocks: blocksWithoutFry, labels: labelsWithoutFry, links: linksWithOrphanSource });

    // 削除済みソースブロックの Activity が生成されていないこと
    const orphanActivity = doc["@graph"].filter((n) => n["@id"] === "activity_h2-fry");
    expect(orphanActivity).toHaveLength(0);

    // 警告が出ること
    const warnings = getWarnings(doc);
    expect(warnings.some((w: any) => w.type === "broken-link")).toBe(true);
  });

  it("有効なリンクは引き続き正常に処理される", () => {
    // 正常なカレーシナリオ — 孤立リンクなし
    const doc = generateProvDocument({ blocks: curryBlocks, labels: curryLabels, links: curryLinks });

    expect(getWarnings(doc)).toHaveLength(0);

    const relations = getRelations(doc);
    const usedRels = relations.filter((r) => r["@type"] === "prov:used");
    expect(usedRels.length).toBeGreaterThanOrEqual(3);
  });
});

// ──────────────────────────────────
// メディアブロックの PROV Entity 化
// ──────────────────────────────────

describe("メディアブロック → PROV Entity", () => {
  it("[材料] セクション内の画像が Entity (prov:used) になる", () => {
    const blocks = [
      {
        id: "h2-mix",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "混合する" }],
        children: [],
      },
      {
        id: "mat-para",
        type: "paragraph",
        content: [{ type: "text", text: "Cu粉末" }],
        children: [],
      },
      {
        id: "img-cu",
        type: "image",
        props: { url: "https://lh3.googleusercontent.com/d/abc123=s0", name: "Cu_sample.png" },
        children: [],
      },
    ];
    const labels = new Map([
      ["h2-mix", "procedure"],
      ["mat-para", "material"],
    ]);

    const doc = generateProvDocument({ blocks, labels, links: [] });

    // メディア Entity が生成されている
    const mediaEntity = doc["@graph"].find((n) => n["@id"] === "entity_media_img-cu");
    expect(mediaEntity).toBeDefined();
    expect(mediaEntity!["rdfs:label"]).toBe("Cu_sample.png");
    expect(mediaEntity!["graphium:mediaType"]).toBe("image");
    expect(mediaEntity!["graphium:mediaUrl"]).toBe("https://lh3.googleusercontent.com/d/abc123=s0");
    expect(mediaEntity!["graphium:entityType"]).toBe("material");

    // prov:used 関係
    const relations = getRelations(doc);
    const mediaUsed = relations.filter((r) => r.to === "entity_media_img-cu" && r["@type"] === "prov:used");
    expect(mediaUsed).toHaveLength(1);
    expect(mediaUsed[0].from).toBe("activity_h2-mix");
  });

  it("[結果] セクション内の画像が Entity (prov:wasGeneratedBy) になる", () => {
    const blocks = [
      {
        id: "h2-eval",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "評価する" }],
        children: [],
      },
      {
        id: "res-para",
        type: "paragraph",
        content: [{ type: "text", text: "XRD結果" }],
        children: [],
      },
      {
        id: "img-xrd",
        type: "image",
        props: { url: "https://lh3.googleusercontent.com/d/xrd456=s0", name: "XRD_result.png" },
        children: [],
      },
    ];
    const labels = new Map([
      ["h2-eval", "procedure"],
      ["res-para", "output"],
    ]);

    const doc = generateProvDocument({ blocks, labels, links: [] });

    const mediaEntity = doc["@graph"].find((n) => n["@id"] === "result_media_img-xrd");
    expect(mediaEntity).toBeDefined();
    expect(mediaEntity!["rdfs:label"]).toBe("XRD_result.png");
    expect(mediaEntity!["graphium:mediaType"]).toBe("image");

    const relations = getRelations(doc);
    const genRels = relations.filter((r) => r.from === "result_media_img-xrd" && r["@type"] === "prov:wasGeneratedBy");
    expect(genRels).toHaveLength(1);
    expect(genRels[0].to).toBe("activity_h2-eval");
  });

  it("[ツール] セクション内の画像が Entity (prov:used, entityType=tool) になる", () => {
    const blocks = [
      {
        id: "h2-sinter",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "焼成する" }],
        children: [],
      },
      {
        id: "tool-para",
        type: "paragraph",
        content: [{ type: "text", text: "電気炉" }],
        children: [],
      },
      {
        id: "img-furnace",
        type: "image",
        props: { url: "https://example.com/furnace.jpg", name: "furnace.jpg" },
        children: [],
      },
    ];
    const labels = new Map([
      ["h2-sinter", "procedure"],
      ["tool-para", "tool"],
    ]);

    const doc = generateProvDocument({ blocks, labels, links: [] });

    const mediaEntity = doc["@graph"].find((n) => n["@id"] === "entity_media_img-furnace");
    expect(mediaEntity).toBeDefined();
    expect(mediaEntity!["graphium:entityType"]).toBe("tool");
  });

  it("ラベルなしセクションのメディアは Entity 化しない", () => {
    const blocks = [
      {
        id: "h2-step",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "ステップ" }],
        children: [],
      },
      {
        id: "para-text",
        type: "paragraph",
        content: [{ type: "text", text: "メモ" }],
        children: [],
      },
      {
        id: "img-memo",
        type: "image",
        props: { url: "https://example.com/memo.png", name: "memo.png" },
        children: [],
      },
    ];
    const labels = new Map([
      ["h2-step", "procedure"],
    ]);

    const doc = generateProvDocument({ blocks, labels, links: [] });

    const mediaEntity = doc["@graph"].find((n) => n["@id"].includes("media"));
    expect(mediaEntity).toBeUndefined();
  });

  it("同一 URL のメディアが複数箇所で使われたら 1 Entity にまとめる", () => {
    const sharedUrl = "https://lh3.googleusercontent.com/d/shared123=s0";
    const blocks = [
      {
        id: "h2-step1",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "ステップ1" }],
        children: [],
      },
      {
        id: "mat1",
        type: "paragraph",
        content: [{ type: "text", text: "材料A" }],
        children: [],
      },
      {
        id: "img-1",
        type: "image",
        props: { url: sharedUrl, name: "shared.png" },
        children: [],
      },
      {
        id: "h2-step2",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "ステップ2" }],
        children: [],
      },
      {
        id: "mat2",
        type: "paragraph",
        content: [{ type: "text", text: "材料B" }],
        children: [],
      },
      {
        id: "img-2",
        type: "image",
        props: { url: sharedUrl, name: "shared.png" },
        children: [],
      },
    ];
    const labels = new Map([
      ["h2-step1", "procedure"],
      ["mat1", "material"],
      ["h2-step2", "procedure"],
      ["mat2", "material"],
    ]);

    const doc = generateProvDocument({ blocks, labels, links: [] });

    // 同一 URL → Entity は 1 つだけ
    const mediaEntities = doc["@graph"].filter((n) => n["@id"].includes("media"));
    expect(mediaEntities).toHaveLength(1);
    expect(mediaEntities[0]["rdfs:label"]).toBe("shared.png");

    // 2つの Activity から prov:used される
    const relations = getRelations(doc);
    const usedRels = relations.filter(
      (r) => r.to === mediaEntities[0]["@id"] && r["@type"] === "prov:used"
    );
    expect(usedRels).toHaveLength(2);
    expect(usedRels.map((r) => r.from).sort()).toEqual(["activity_h2-step1", "activity_h2-step2"]);
  });

  it("見出しでラベルコンテキストがリセットされる", () => {
    const blocks = [
      {
        id: "h2-step",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "ステップ" }],
        children: [],
      },
      {
        id: "mat",
        type: "paragraph",
        content: [{ type: "text", text: "材料" }],
        children: [],
      },
      {
        id: "h3-note",
        type: "heading",
        props: { level: 3 },
        content: [{ type: "text", text: "補足" }],
        children: [],
      },
      {
        id: "img-after-heading",
        type: "image",
        props: { url: "https://example.com/note.png", name: "note.png" },
        children: [],
      },
    ];
    const labels = new Map([
      ["h2-step", "procedure"],
      ["mat", "material"],
    ]);

    const doc = generateProvDocument({ blocks, labels, links: [] });

    // ラベルなし見出し後のメディアは Entity 化されない
    const mediaEntity = doc["@graph"].find((n) => n["@id"].includes("media"));
    expect(mediaEntity).toBeUndefined();
  });

  it("動画・音声・PDF もメディア Entity として扱われる", () => {
    const blocks = [
      {
        id: "h2-observe",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "観察する" }],
        children: [],
      },
      {
        id: "res-label",
        type: "paragraph",
        content: [{ type: "text", text: "観察結果" }],
        children: [],
      },
      {
        id: "vid-result",
        type: "video",
        props: { url: "https://example.com/reaction.mp4", name: "reaction.mp4" },
        children: [],
      },
      {
        id: "pdf-report",
        type: "pdf",
        props: { url: "https://example.com/report.pdf", name: "report.pdf" },
        children: [],
      },
    ];
    const labels = new Map([
      ["h2-observe", "procedure"],
      ["res-label", "output"],
    ]);

    const doc = generateProvDocument({ blocks, labels, links: [] });

    const vidEntity = doc["@graph"].find((n) => n["@id"] === "result_media_vid-result");
    expect(vidEntity).toBeDefined();
    expect(vidEntity!["graphium:mediaType"]).toBe("video");

    const pdfEntity = doc["@graph"].find((n) => n["@id"] === "result_media_pdf-report");
    expect(pdfEntity).toBeDefined();
    expect(pdfEntity!["graphium:mediaType"]).toBe("pdf");
  });

  it("props.name がない場合は URL からラベルを取得する", () => {
    const blocks = [
      {
        id: "h2-step",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "ステップ" }],
        children: [],
      },
      {
        id: "mat",
        type: "paragraph",
        content: [{ type: "text", text: "材料" }],
        children: [],
      },
      {
        id: "img-noname",
        type: "image",
        props: { url: "https://lh3.googleusercontent.com/d/fileId123=s0" },
        children: [],
      },
    ];
    const labels = new Map([
      ["h2-step", "procedure"],
      ["mat", "material"],
    ]);

    const doc = generateProvDocument({ blocks, labels, links: [] });

    const mediaEntity = doc["@graph"].find((n) => n["@id"] === "entity_media_img-noname");
    expect(mediaEntity).toBeDefined();
    // URL からファイル名部分を取得
    expect(mediaEntity!["rdfs:label"]).toBeTruthy();
    expect(mediaEntity!["rdfs:label"].length).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────
// 子ブロックの暗黙的属性化
// ──────────────────────────────────

describe("子ブロック（インデント）→ 親 Entity の属性", () => {
  it("[結果] の子画像が属性（mediaUrl 付き）として埋め込まれる", () => {
    const imgUrl = "https://lh3.googleusercontent.com/d/xrd789=s0";
    const blocks = [
      {
        id: "h2-eval",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "評価する" }],
        children: [],
      },
      {
        id: "res-para",
        type: "paragraph",
        content: [{ type: "text", text: "XRD結果" }],
        children: [
          {
            id: "child-img",
            type: "image",
            props: { url: imgUrl, name: "XRD_pattern.png" },
            children: [],
          },
        ],
      },
    ];
    const labels = new Map([
      ["h2-eval", "procedure"],
      ["res-para", "output"],
    ]);

    const doc = generateProvDocument({ blocks, labels, links: [] });

    const resultEntity = doc["@graph"].find((n) => n["@id"] === "result_res-para");
    expect(resultEntity).toBeDefined();
    expect(resultEntity!["graphium:attributes"]).toBeDefined();

    const mediaAttr = resultEntity!["graphium:attributes"]!.find(
      (a: any) => a["rdfs:label"] === "XRD_pattern.png"
    );
    expect(mediaAttr).toBeDefined();
    expect(mediaAttr!["graphium:mediaUrl"]).toBe(imgUrl);

    // 子ブロックとして処理されたメディアは独立 Entity にならない
    const mediaEntity = doc["@graph"].find((n) => n["@id"].includes("media"));
    expect(mediaEntity).toBeUndefined();
  });

  it("[材料] の子画像が属性として埋め込まれる", () => {
    const blocks = [
      {
        id: "h2-mix",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "混合する" }],
        children: [],
      },
      {
        id: "mat-para",
        type: "paragraph",
        content: [{ type: "text", text: "Cu粉末" }],
        children: [
          {
            id: "child-photo",
            type: "image",
            props: { url: "https://example.com/cu.jpg", name: "Cu_photo.jpg" },
            children: [],
          },
        ],
      },
    ];
    const labels = new Map([
      ["h2-mix", "procedure"],
      ["mat-para", "material"],
    ]);

    const doc = generateProvDocument({ blocks, labels, links: [] });

    const entity = doc["@graph"].find((n) => n["@id"] === "entity_mat-para");
    expect(entity).toBeDefined();
    expect(entity!["graphium:attributes"]).toHaveLength(1);
    expect(entity!["graphium:attributes"]![0]["rdfs:label"]).toBe("Cu_photo.jpg");
    expect(entity!["graphium:attributes"]![0]["graphium:mediaUrl"]).toBe("https://example.com/cu.jpg");
  });

  it("ラベル付きの子ブロックは暗黙的属性化されない（二重処理防止）", () => {
    const blocks = [
      {
        id: "h2-step",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "ステップ" }],
        children: [],
      },
      {
        id: "res-para",
        type: "paragraph",
        content: [{ type: "text", text: "結果" }],
        children: [
          {
            id: "child-labeled",
            type: "paragraph",
            content: [{ type: "text", text: "温度 800°C" }],
            children: [],
          },
        ],
      },
    ];
    const labels = new Map([
      ["h2-step", "procedure"],
      ["res-para", "output"],
      ["child-labeled", "attribute"],
    ]);

    const doc = generateProvDocument({ blocks, labels, links: [] });

    const resultEntity = doc["@graph"].find((n) => n["@id"] === "result_res-para");
    expect(resultEntity).toBeDefined();

    // [属性] ラベル経由の属性のみ（暗黙的属性は追加されない）
    const attrs = resultEntity!["graphium:attributes"] ?? [];
    const tempAttrs = attrs.filter((a: any) => a["rdfs:label"] === "温度 800°C");
    expect(tempAttrs).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────
// Phase D-1: インラインハイライトから PROV Entity / Attribute 生成
// ──────────────────────────────────────────────
describe("インラインハイライト → PROV Entity / Attribute (Phase D-1)", () => {
  const styled = (text: string, styles: Record<string, string | boolean> = {}) => ({
    type: "text",
    text,
    styles,
  });

  it("inlineMaterial 1 つ → Entity (prov:Entity, subtype=material) + prov:used", () => {
    const blocks = [
      {
        id: "h-step",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Step1" }],
        children: [],
      },
      {
        id: "p-body",
        type: "paragraph",
        content: [
          styled("NaCl", { inlineMaterial: "ent_nacl" }),
          styled(" を 5g 投入", {}),
        ],
        children: [],
      },
    ];
    const labels = new Map([["h-step", "procedure"]]);
    const doc = generateProvDocument({ blocks, labels, links: [] });

    const ent = doc["@graph"].find((n) => n["@id"] === "inline_material_ent_nacl");
    expect(ent).toBeDefined();
    expect(ent!["@type"]).toBe("prov:Entity");
    expect(ent!["rdfs:label"]).toBe("NaCl");
    expect(ent!["graphium:entityType"]).toBe("material");

    const acts = doc["@graph"].find((n) => n["@id"] === "activity_h-step");
    const used = (acts as any)["prov:used"] ?? [];
    expect(used.some((u: any) => u["@id"] === "inline_material_ent_nacl")).toBe(true);
  });

  it("inlineOutput → prov:wasGeneratedBy", () => {
    const blocks = [
      {
        id: "h-step",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Step1" }],
        children: [],
      },
      {
        id: "p-out",
        type: "paragraph",
        content: [
          styled("透明溶液", { inlineOutput: "ent_sol" }),
          styled(" が得られた"),
        ],
        children: [],
      },
    ];
    const labels = new Map([["h-step", "procedure"]]);
    const doc = generateProvDocument({ blocks, labels, links: [] });

    const ent = doc["@graph"].find((n) => n["@id"] === "inline_output_ent_sol");
    expect(ent).toBeDefined();
    expect(ent!["prov:wasGeneratedBy"]?.[0]?.["@id"]).toBe("activity_h-step");
  });

  it("inlineAttribute は隣接 Entity の attribute として埋め込まれる", () => {
    const blocks = [
      {
        id: "h-step",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Step1" }],
        children: [],
      },
      {
        id: "p-body",
        type: "paragraph",
        content: [
          styled("NaCl", { inlineMaterial: "ent_nacl" }),
          styled(" "),
          styled("5g", { inlineAttribute: "ent_5g" }),
          styled(" を投入"),
        ],
        children: [],
      },
    ];
    const labels = new Map([["h-step", "procedure"]]);
    const doc = generateProvDocument({ blocks, labels, links: [] });

    const nacl = doc["@graph"].find((n) => n["@id"] === "inline_material_ent_nacl");
    expect(nacl).toBeDefined();
    const attrs = nacl!["graphium:attributes"] ?? [];
    expect(attrs.some((a: any) => a["rdfs:label"] === "5g")).toBe(true);

    // attribute は独立 Entity ノードを作らない
    expect(doc["@graph"].find((n) => n["@id"] === "inline_attribute_ent_5g")).toBeUndefined();
  });

  it("inlineAttribute が同ブロックに Entity を持たない時は Activity の attribute になる", () => {
    const blocks = [
      {
        id: "h-step",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Step1" }],
        children: [],
      },
      {
        id: "p-body",
        type: "paragraph",
        content: [
          styled("80°C", { inlineAttribute: "ent_temp" }),
          styled(" の条件で実施"),
        ],
        children: [],
      },
    ];
    const labels = new Map([["h-step", "procedure"]]);
    const doc = generateProvDocument({ blocks, labels, links: [] });

    const act = doc["@graph"].find((n) => n["@id"] === "activity_h-step");
    expect(act).toBeDefined();
    const attrs = act!["graphium:attributes"] ?? [];
    expect(attrs.some((a: any) => a["rdfs:label"] === "80°C")).toBe(true);
  });

  it("同 entityId の複数 text inline は 1 Entity に集約され、テキストが連結される", () => {
    const blocks = [
      {
        id: "h-step",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Step1" }],
        children: [],
      },
      {
        id: "p-body",
        type: "paragraph",
        content: [
          styled("Na", { inlineMaterial: "ent_nacl" }),
          styled("Cl", { inlineMaterial: "ent_nacl" }),
          styled(" を投入"),
        ],
        children: [],
      },
    ];
    const labels = new Map([["h-step", "procedure"]]);
    const doc = generateProvDocument({ blocks, labels, links: [] });

    const ent = doc["@graph"].find((n) => n["@id"] === "inline_material_ent_nacl");
    expect(ent).toBeDefined();
    expect(ent!["rdfs:label"]).toBe("NaCl");
  });

  it("Activity スコープ外（procedure 見出し前）のインラインは Activity edge を持たない", () => {
    const blocks = [
      {
        id: "p-orphan",
        type: "paragraph",
        content: [styled("孤立 NaCl", { inlineMaterial: "ent_orph" })],
        children: [],
      },
      {
        id: "h-step",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Step1" }],
        children: [],
      },
    ];
    const labels = new Map([["h-step", "procedure"]]);
    const doc = generateProvDocument({ blocks, labels, links: [] });

    const ent = doc["@graph"].find((n) => n["@id"] === "inline_material_ent_orph");
    expect(ent).toBeDefined();
    // Activity 側の prov:used に含まれない
    const act = doc["@graph"].find((n) => n["@id"] === "activity_h-step") as any;
    const used = act?.["prov:used"] ?? [];
    expect(used.some((u: any) => u["@id"] === "inline_material_ent_orph")).toBe(false);
  });
});

// ──────────────────────────────────────────────
// Phase D-2: Plan / Result phase scoping
// ──────────────────────────────────────────────
describe("Plan / Result phase スコーピング (Phase D-2)", () => {
  const styled = (text: string, styles: Record<string, string | boolean> = {}) => ({
    type: "text",
    text,
    styles,
  });

  it("#plan 配下のインライン Entity は graphium:phase=plan で識別される（型は prov:Entity のまま）", () => {
    const blocks = [
      { id: "h-step", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Step1" }], children: [] },
      { id: "h-plan", type: "heading", props: { level: 3 }, content: [{ type: "text", text: "計画" }], children: [] },
      { id: "p-plan", type: "paragraph", content: [styled("NaCl", { inlineMaterial: "ent_nacl" }), styled(" 5g 予定")], children: [] },
    ];
    const labels = new Map([
      ["h-step", "procedure"],
      ["h-plan", "plan"],
    ]);
    const doc = generateProvDocument({ blocks, labels, links: [] });

    const planEnt = doc["@graph"].find((n) => n["@id"] === "inline_material_ent_nacl_plan");
    expect(planEnt).toBeDefined();
    // PROV-DM 厳密性: 個別の予定物質を prov:Plan 型にしない（Plan は計画書全体を指す概念）
    expect(planEnt!["@type"]).toBe("prov:Entity");
    expect(planEnt!["graphium:phase"]).toBe("plan");
  });

  it("#result 配下のインライン Entity は execution（既存挙動）+ graphium:phase=result", () => {
    const blocks = [
      { id: "h-step", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Step1" }], children: [] },
      { id: "h-result", type: "heading", props: { level: 3 }, content: [{ type: "text", text: "結果" }], children: [] },
      { id: "p-res", type: "paragraph", content: [styled("NaCl", { inlineMaterial: "ent_nacl" }), styled(" 5.02g 実測")], children: [] },
    ];
    const labels = new Map([
      ["h-step", "procedure"],
      ["h-result", "result"],
    ]);
    const doc = generateProvDocument({ blocks, labels, links: [] });

    const execEnt = doc["@graph"].find((n) => n["@id"] === "inline_material_ent_nacl");
    expect(execEnt).toBeDefined();
    expect(execEnt!["@type"]).toBe("prov:Entity");
    expect(execEnt!["graphium:phase"]).toBe("result");
  });

  it("phase 未指定（procedure 直下）は graphium:phase=execution のデフォルト", () => {
    const blocks = [
      { id: "h-step", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Step1" }], children: [] },
      { id: "p-body", type: "paragraph", content: [styled("NaCl", { inlineMaterial: "ent_nacl" })], children: [] },
    ];
    const labels = new Map([["h-step", "procedure"]]);
    const doc = generateProvDocument({ blocks, labels, links: [] });

    const ent = doc["@graph"].find((n) => n["@id"] === "inline_material_ent_nacl");
    expect(ent!["graphium:phase"]).toBe("execution");
  });

  it("同 entityId が plan/result 両方にある時、execution → plan に prov:wasDerivedFrom エッジ", () => {
    const blocks = [
      { id: "h-step", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Step1" }], children: [] },
      { id: "h-plan", type: "heading", props: { level: 3 }, content: [{ type: "text", text: "計画" }], children: [] },
      { id: "p-plan", type: "paragraph", content: [styled("NaCl", { inlineMaterial: "ent_nacl" })], children: [] },
      { id: "h-result", type: "heading", props: { level: 3 }, content: [{ type: "text", text: "結果" }], children: [] },
      { id: "p-res", type: "paragraph", content: [styled("NaCl", { inlineMaterial: "ent_nacl" })], children: [] },
    ];
    const labels = new Map([
      ["h-step", "procedure"],
      ["h-plan", "plan"],
      ["h-result", "result"],
    ]);
    const doc = generateProvDocument({ blocks, labels, links: [] });

    const planEnt = doc["@graph"].find((n) => n["@id"] === "inline_material_ent_nacl_plan");
    const execEnt = doc["@graph"].find((n) => n["@id"] === "inline_material_ent_nacl");
    expect(planEnt).toBeDefined();
    expect(execEnt).toBeDefined();

    // execution Entity に wasDerivedFrom が含まれ、plan Entity を指している
    const derivations = (execEnt as any)["prov:wasDerivedFrom"] ?? [];
    expect(derivations.some((s: any) => s["@id"] === "inline_material_ent_nacl_plan")).toBe(true);
  });

  it("plan / result 見出しは Activity を生まず、procedure の Activity スコープを保つ", () => {
    const blocks = [
      { id: "h-step", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Step1" }], children: [] },
      { id: "h-plan", type: "heading", props: { level: 3 }, content: [{ type: "text", text: "計画" }], children: [] },
      { id: "p-plan", type: "paragraph", content: [styled("NaCl", { inlineMaterial: "ent_nacl" })], children: [] },
    ];
    const labels = new Map([
      ["h-step", "procedure"],
      ["h-plan", "plan"],
    ]);
    const doc = generateProvDocument({ blocks, labels, links: [] });

    // Activity は h-step だけ
    const activities = doc["@graph"].filter((n) => n["@type"] === "prov:Activity");
    expect(activities).toHaveLength(1);
    expect(activities[0]["@id"]).toBe("activity_h-step");

    // h-plan に対する Activity は作られない
    expect(doc["@graph"].find((n) => n["@id"] === "activity_h-plan")).toBeUndefined();

    // 計画 Entity は activity_h-step の prov:used に含まれる
    const stepAct = doc["@graph"].find((n) => n["@id"] === "activity_h-step");
    const used = (stepAct as any)["prov:used"] ?? [];
    expect(used.some((u: any) => u["@id"] === "inline_material_ent_nacl_plan")).toBe(true);
  });
});

// ──────────────────────────────────────────────
// Phase D-3-β: メディアブロックのインラインラベル
// ──────────────────────────────────────────────
describe("メディアブロック × インラインラベル (Phase D-3-β)", () => {
  it("image ブロックに mediaInlineLabels で output ラベルを付与 → prov:wasGeneratedBy + mediaUrl/mediaType", () => {
    const blocks = [
      {
        id: "h-step",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Step1" }],
        children: [],
      },
      {
        id: "img-1",
        type: "image",
        props: { url: "https://example.com/run.png", name: "run.png" },
        content: undefined,
        children: [],
      },
    ];
    const labels = new Map([["h-step", "procedure"]]);
    const mediaInlineLabels = new Map([
      ["img-1", { label: "output" as const, entityId: "ent_run_png" }],
    ]);
    const doc = generateProvDocument({ blocks, labels, links: [], mediaInlineLabels });

    const ent = doc["@graph"].find((n) => n["@id"] === "inline_output_ent_run_png");
    expect(ent).toBeDefined();
    expect(ent!["@type"]).toBe("prov:Entity");
    expect(ent!["rdfs:label"]).toBe("run.png");
    expect((ent as any)["graphium:mediaUrl"]).toBe("https://example.com/run.png");
    expect((ent as any)["graphium:mediaType"]).toBe("image");
    // output Entity は LABEL_TO_ENTITY_SUBTYPE 対象外（material / tool のみ subtype を持つ）
    expect(ent!["prov:wasGeneratedBy"]?.[0]?.["@id"]).toBe("activity_h-step");
  });

  it("video ブロックに material ラベル → prov:used、attribute ラベルなしメディアは祖先 attribute から除外", () => {
    const blocks = [
      {
        id: "h-step",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Step1" }],
        children: [],
      },
      {
        id: "vid-1",
        type: "video",
        props: { url: "https://example.com/sample.mp4", name: "sample.mp4" },
        content: undefined,
        children: [],
      },
    ];
    const labels = new Map([["h-step", "procedure"]]);
    const mediaInlineLabels = new Map([
      ["vid-1", { label: "material" as const, entityId: "ent_vid" }],
    ]);
    const doc = generateProvDocument({ blocks, labels, links: [], mediaInlineLabels });

    // material → prov:used
    const stepAct = doc["@graph"].find((n) => n["@id"] === "activity_h-step");
    const used = (stepAct as any)["prov:used"] ?? [];
    expect(used.some((u: any) => u["@id"] === "inline_material_ent_vid")).toBe(true);

    // 祖先の attribute としても重複登録されていない
    const acts = doc["@graph"].filter((n) => n["@type"] === "prov:Activity");
    for (const a of acts) {
      const attrs = (a as any)["graphium:attributes"] ?? [];
      expect(attrs.find((x: any) => x["graphium:blockId"] === "vid-1")).toBeUndefined();
    }
  });

  it("pdf に attribute ラベル → 親 Activity の attribute に attach", () => {
    const blocks = [
      {
        id: "h-step",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Step1" }],
        children: [],
      },
      {
        id: "pdf-1",
        type: "pdf",
        props: { url: "https://example.com/manual.pdf", name: "manual.pdf" },
        content: undefined,
        children: [],
      },
    ];
    const labels = new Map([["h-step", "procedure"]]);
    const mediaInlineLabels = new Map([
      ["pdf-1", { label: "attribute" as const, entityId: "ent_man" }],
    ]);
    const doc = generateProvDocument({ blocks, labels, links: [], mediaInlineLabels });

    const stepAct = doc["@graph"].find((n) => n["@id"] === "activity_h-step");
    const attrs = (stepAct as any)["graphium:attributes"] ?? [];
    const pdfAttr = attrs.find((a: any) => a["rdfs:label"] === "manual.pdf");
    expect(pdfAttr).toBeDefined();
    // メディア attribute はサムネ描画のため mediaUrl / mediaType を保持する
    expect(pdfAttr["graphium:mediaUrl"]).toBe("https://example.com/manual.pdf");
    expect(pdfAttr["graphium:mediaType"]).toBe("pdf");
  });

  it("image に attribute（パラメータ）ラベル → attribute が mediaUrl/mediaType を保持しサムネ表示できる", () => {
    const blocks = [
      {
        id: "h-step",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Step1" }],
        children: [],
      },
      {
        id: "img-attr",
        type: "image",
        props: { url: "https://example.com/spec.png", name: "spec.png" },
        content: undefined,
        children: [],
      },
    ];
    const labels = new Map([["h-step", "procedure"]]);
    const mediaInlineLabels = new Map([
      ["img-attr", { label: "attribute" as const, entityId: "ent_spec" }],
    ]);
    const doc = generateProvDocument({ blocks, labels, links: [], mediaInlineLabels });

    const stepAct = doc["@graph"].find((n) => n["@id"] === "activity_h-step");
    const attrs = (stepAct as any)["graphium:attributes"] ?? [];
    const imgAttr = attrs.find((a: any) => a["graphium:blockId"] === "img-attr");
    expect(imgAttr).toBeDefined();
    expect(imgAttr["rdfs:label"]).toBe("spec.png");
    // ここが回帰ポイント: mediaUrl/mediaType が無いと view がファイル名表示にフォールバックする
    expect(imgAttr["graphium:mediaUrl"]).toBe("https://example.com/spec.png");
    expect(imgAttr["graphium:mediaType"]).toBe("image");
  });

  it("mediaInlineLabels が無い場合は従来の [材料] パラグラフ配下の画像 → entity_media_<id> が機能する（後方互換）", () => {
    const blocks = [
      {
        id: "h-step",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Step1" }],
        children: [],
      },
      {
        id: "mat-para",
        type: "paragraph",
        content: [{ type: "text", text: "Cu粉末" }],
        children: [],
      },
      {
        id: "img-1",
        type: "image",
        props: { url: "https://example.com/x.png", name: "x.png" },
        children: [],
      },
    ];
    const labels = new Map([
      ["h-step", "procedure"],
      ["mat-para", "material"],
    ]);
    const doc = generateProvDocument({ blocks, labels, links: [] });
    expect(doc["@graph"].find((n) => n["@id"] === "entity_media_img-1")).toBeDefined();
  });
});

// ──────────────────────────────────
// Phase F: Parameter 親 Entity 明示指定（attribute binding）
// ──────────────────────────────────
describe("Parameter 親 Entity 明示指定（Phase F）", () => {
  // Step 1 と Step 2 を持つ doc。Step 2 の Parameter が Step 1 の Material を指す
  const blocks = [
    {
      id: "h-step1",
      type: "heading",
      props: { level: 2 },
      content: [{ type: "text", text: "Step 1" }],
      children: [],
    },
    {
      id: "p-step1",
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "NaCl",
          styles: { inlineMaterial: "ent_mat_nacl" },
        },
      ],
      children: [],
    },
    {
      id: "h-step2",
      type: "heading",
      props: { level: 2 },
      content: [{ type: "text", text: "Step 2" }],
      children: [],
    },
    {
      id: "p-step2",
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "5g",
          styles: { inlineAttribute: "ent_attr_x@ent_mat_nacl" },
        },
      ],
      children: [],
    },
  ];
  const labels = new Map([
    ["h-step1", "procedure"],
    ["h-step2", "procedure"],
  ]);

  it("クロスブロック parent override が解決され、attribute が指定 Entity に attach される", () => {
    const doc = generateProvDocument({ blocks, labels, links: [] });
    const naclNode = doc["@graph"].find((n) => n["@id"].includes("ent_mat_nacl"));
    expect(naclNode).toBeDefined();
    const attrs = (naclNode as any)?.["graphium:attributes"] ?? [];
    expect(attrs.length).toBe(1);
    expect(attrs[0]["rdfs:label"]).toBe("5g");
  });

  it("activity マーカーで親 Activity に直結される（同ブロックに Entity があっても）", () => {
    const blocksLocal = [
      {
        id: "h",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Step" }],
        children: [],
      },
      {
        id: "p",
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "NaCl",
            styles: { inlineMaterial: "ent_mat_nacl" },
          },
          { type: "text", text: " " },
          {
            type: "text",
            text: "5g",
            styles: { inlineAttribute: "ent_attr_x@activity" },
          },
        ],
        children: [],
      },
    ];
    const labelsLocal = new Map([["h", "procedure"]]);
    const doc = generateProvDocument({ blocks: blocksLocal, labels: labelsLocal, links: [] });
    // Activity ノードの attributes に attach されているはず
    const actNode = doc["@graph"].find((n) => n["@type"] === "prov:Activity");
    expect(actNode).toBeDefined();
    const attrs = (actNode as any)?.["graphium:attributes"] ?? [];
    expect(attrs.find((a: any) => a["rdfs:label"] === "5g")).toBeDefined();
    // Material ノードには attach されていない
    const matNode = doc["@graph"].find((n) => n["@id"].includes("ent_mat_nacl"));
    const matAttrs = (matNode as any)?.["graphium:attributes"] ?? [];
    expect(matAttrs.find((a: any) => a["rdfs:label"] === "5g")).toBeUndefined();
  });

  it("@parent 無し（旧形式）は最寄り推論で動作する（後方互換）", () => {
    const blocksLocal = [
      {
        id: "h",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Step" }],
        children: [],
      },
      {
        id: "p",
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "NaCl",
            styles: { inlineMaterial: "ent_mat_nacl" },
          },
          { type: "text", text: " " },
          {
            type: "text",
            text: "5g",
            styles: { inlineAttribute: "ent_attr_x" },
          },
        ],
        children: [],
      },
    ];
    const labelsLocal = new Map([["h", "procedure"]]);
    const doc = generateProvDocument({ blocks: blocksLocal, labels: labelsLocal, links: [] });
    const matNode = doc["@graph"].find((n) => n["@id"].includes("ent_mat_nacl"));
    const matAttrs = (matNode as any)?.["graphium:attributes"] ?? [];
    expect(matAttrs.find((a: any) => a["rdfs:label"] === "5g")).toBeDefined();
  });
});

// ──────────────────────────────────
// シナリオ: 階層的に書かれた parameter (ネストされた子ブロック)
// 例:
//   ## Ingredients [step]
//     - Bread flour [material]
//       - Amount: 300g [attribute]
//   parameter は親ブロック (Bread flour Entity) に紐づくべき
// ──────────────────────────────────
describe("階層的 parameter の親解決", () => {
  it("ネストされた attribute は親ブロックの material Entity に紐づく", () => {
    const blocks = [
      {
        id: "h-ingredients",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Ingredients" }],
        children: [
          {
            id: "b-flour",
            type: "bulletListItem",
            content: [{ type: "text", text: "Bread flour" }],
            children: [
              {
                id: "b-flour-amount",
                type: "bulletListItem",
                content: [{ type: "text", text: "Amount: 300g" }],
                children: [],
              },
            ],
          },
          {
            id: "b-water",
            type: "bulletListItem",
            content: [{ type: "text", text: "Water" }],
            children: [
              {
                id: "b-water-amount",
                type: "bulletListItem",
                content: [{ type: "text", text: "Amount: 200g" }],
                children: [],
              },
            ],
          },
        ],
      },
    ];
    const labels = new Map([
      ["h-ingredients", "procedure"],
      ["b-flour", "material"],
      ["b-flour-amount", "attribute"],
      ["b-water", "material"],
      ["b-water-amount", "attribute"],
    ]);
    const doc = generateProvDocument({ blocks, labels, links: [] });

    const flourEnt = doc["@graph"].find((n) => n["@id"] === "entity_b-flour");
    const waterEnt = doc["@graph"].find((n) => n["@id"] === "entity_b-water");
    const ingredientsAct = doc["@graph"].find((n) => n["@id"] === "activity_h-ingredients");

    // parameter は対応する Entity に attach される
    expect(flourEnt?.["graphium:attributes"]?.some((a: any) => a["rdfs:label"] === "Amount: 300g")).toBe(true);
    expect(waterEnt?.["graphium:attributes"]?.some((a: any) => a["rdfs:label"] === "Amount: 200g")).toBe(true);

    // Activity 側には parameter が漏れない
    const actAttrs = (ingredientsAct as any)?.["graphium:attributes"] ?? [];
    expect(actAttrs.some((a: any) => a["rdfs:label"]?.startsWith("Amount"))).toBe(false);
  });

  it("インラインスタイル（inlineMaterial/inlineAttribute）でも親ブロックを遡って解決する", () => {
    // 実ノートの構造:
    //   paragraph "Bread flour" (inlineMaterial)
    //     └ paragraph "Amount: 300g" (inlineAttribute)
    // ブロックレベル label は付かず、style 経由でインライン entity が付与される。
    const blocks = [
      {
        id: "h-ingredients",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Ingredients" }],
        children: [],
      },
      {
        id: "p-flour",
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Bread flour",
            styles: { inlineMaterial: "ent_material_flour" },
          },
        ],
        children: [
          {
            id: "p-flour-amount",
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Amount: 300g",
                styles: { inlineAttribute: "ent_attribute_amount300" },
              },
            ],
            children: [],
          },
        ],
      },
    ];
    const labels = new Map([["h-ingredients", "procedure"]]);
    const doc = generateProvDocument({ blocks, labels, links: [] });

    const flourEnt = doc["@graph"].find(
      (n) => n["@id"] === "inline_material_ent_material_flour",
    );
    expect(flourEnt).toBeDefined();
    expect(
      flourEnt?.["graphium:attributes"]?.some(
        (a: any) => a["rdfs:label"] === "Amount: 300g",
      ),
    ).toBe(true);

    // Activity に parameter が漏れていないこと
    const ingredientsAct = doc["@graph"].find(
      (n) => n["@id"] === "activity_h-ingredients",
    );
    const actAttrs = (ingredientsAct as any)?.["graphium:attributes"] ?? [];
    expect(actAttrs.some((a: any) => a["rdfs:label"]?.startsWith("Amount"))).toBe(false);
  });

  it("同ブロック内 Entity がある場合は従来どおり距離ベース解決（インラインハイライト維持）", () => {
    // 「中火 5分」(attribute) は同ブロックの「フライパン」(tool) に紐づくべき
    const blocks = [
      {
        id: "h-fry",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "炒める" }],
        children: [],
      },
      {
        id: "p-mixed",
        type: "paragraph",
        content: [{ type: "text", text: "フライパンで中火 5分" }],
        children: [],
      },
    ];
    const labels = new Map([
      ["h-fry", "procedure"],
      // ブロックレベル label ではなくインラインで擬似的にテストするのは難しいので
      // ここでは block-level の attribute が同ブロック scope の Activity に落ちることだけ確認
      ["p-mixed", "attribute"],
    ]);
    const doc = generateProvDocument({ blocks, labels, links: [] });
    // 親ブロック (h-fry) は procedure なので、findParentLabeledNodeId は null を返し、
    // 従来どおり scope の Activity にフォールバックする
    const fryAct = doc["@graph"].find((n) => n["@id"] === "activity_h-fry");
    expect(fryAct?.["graphium:attributes"]?.some((a: any) => a["rdfs:label"] === "フライパンで中火 5分")).toBe(true);
  });
});

// ──────────────────────────────────
// informed_by + inline output の entity 統合（v5+, "の結果" placeholder 抑制）
// ──────────────────────────────────

describe("informed_by + inline_output（synthetic placeholder の抑制）", () => {
  const styled = (text: string, styles: Record<string, string | boolean> = {}) => ({
    type: "text",
    text,
    styles,
  });

  const buildTwoStepDoc = (params: {
    prevOutputText?: string;
    currMaterialText?: string;
    currMaterialStyle?: "inlineMaterial" | "inlineTool";
  }) => {
    const blocks: any[] = [
      { id: "h-prev", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Step A" }], children: [] },
    ];
    if (params.prevOutputText !== undefined) {
      blocks.push({
        id: "p-prev",
        type: "paragraph",
        content: [styled(params.prevOutputText, { inlineOutput: "ent_prev_out" })],
        children: [],
      });
    }
    blocks.push({ id: "h-curr", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Step B" }], children: [] });
    if (params.currMaterialText !== undefined) {
      blocks.push({
        id: "p-curr",
        type: "paragraph",
        content: [
          styled(params.currMaterialText, {
            [params.currMaterialStyle ?? "inlineMaterial"]: "ent_curr_mat",
          }),
        ],
        children: [],
      });
    }
    const labels = new Map([
      ["h-prev", "procedure"],
      ["h-curr", "procedure"],
    ]);
    const links = [
      {
        id: "link-1",
        sourceBlockId: "h-curr",
        targetBlockId: "h-prev",
        type: "informed_by" as const,
        layer: "prov" as const,
        createdBy: "human" as const,
      },
    ];
    return generateProvDocument({ blocks, labels, links });
  };

  it("prev に inline_output があれば synthetic 'の結果' は作らず inline_output を proxy にする", () => {
    const doc = buildTwoStepDoc({
      prevOutputText: "annealed sample",
      currMaterialText: undefined, // current 側に material 無し → unification 不成立 → proxy 経路
    });
    const synthetic = doc["@graph"].filter((n) => n["@id"].startsWith("result_synthetic_"));
    expect(synthetic).toHaveLength(0);
    // inline_output が proxy として使われている
    const currAct = doc["@graph"].find((n) => n["@id"] === "activity_h-curr") as any;
    const usedIds = (currAct?.["prov:used"] ?? []).map((u: any) => u["@id"]);
    expect(usedIds).toContain("inline_output_ent_prev_out");
  });

  it("prev の inline_output と current の inline_material が同 label なら 1 Entity に merge する", () => {
    const doc = buildTwoStepDoc({
      prevOutputText: "annealed sample",
      currMaterialText: "annealed sample",
    });
    const entities = doc["@graph"].filter((n) => n["@type"] === "prov:Entity");
    // "annealed sample" を表す Entity は inline_output_ent_prev_out 1 個のみ
    const merged = entities.filter((e) => e["rdfs:label"] === "annealed sample");
    expect(merged).toHaveLength(1);
    expect(merged[0]["@id"]).toBe("inline_output_ent_prev_out");
    // synthetic placeholder も作られない
    const synthetic = doc["@graph"].filter((n) => n["@id"].startsWith("result_synthetic_"));
    expect(synthetic).toHaveLength(0);
    // current の inline_material は graph 上から消えている
    const orphan = doc["@graph"].filter((n) => n["@id"] === "inline_material_ent_curr_mat");
    expect(orphan).toHaveLength(0);
    // merged entity が両方向に edge を持つ
    const mergedEnt = merged[0] as any;
    const usedBy = doc["@graph"]
      .filter((n) => n["@type"] === "prov:Activity")
      .filter((act: any) =>
        (act["prov:used"] ?? []).some((u: any) => u["@id"] === merged[0]["@id"]),
      );
    expect(usedBy.map((a) => a["@id"])).toContain("activity_h-curr");
    expect(mergedEnt["prov:wasGeneratedBy"]?.[0]?.["@id"]).toBe("activity_h-prev");
  });

  it("inline_output / inline_material どちらも無ければ従来通り synthetic placeholder を作る", () => {
    const doc = buildTwoStepDoc({});
    const synthetic = doc["@graph"].filter((n) => n["@id"] === "result_synthetic_h-prev");
    expect(synthetic).toHaveLength(1);
  });

  it("inline_tool も derivedFrom 経由で inline_output と merge する（label が一致すれば）", () => {
    const doc = buildTwoStepDoc({
      prevOutputText: "calibrated furnace",
      currMaterialText: "calibrated furnace",
      currMaterialStyle: "inlineTool",
    });
    const merged = doc["@graph"].filter(
      (n) => n["@type"] === "prov:Entity" && n["rdfs:label"] === "calibrated furnace",
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]["@id"]).toBe("inline_output_ent_prev_out");
  });

  // ── 出力が複数あるとき: どれを使ったかは特定できない ──
  // 「先頭の出力を勝手に proxy にする」旧挙動は、分岐（出力ごとに別の後続）
  // で誤った受け渡しを描くため撤去した。特定は unification（同名入力）で行う。

  const buildMultiOutputDoc = (withCurrMaterial: boolean) => {
    const blocks: any[] = [
      { id: "h-prev", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Step A" }], children: [] },
      {
        id: "p-prev",
        type: "paragraph",
        content: [
          styled("batch A", { inlineOutput: "ent_out_a" }),
          styled(" and ", {}),
          styled("batch B", { inlineOutput: "ent_out_b" }),
        ],
        children: [],
      },
      { id: "h-curr", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Step B" }], children: [] },
    ];
    if (withCurrMaterial) {
      blocks.push({
        id: "p-curr",
        type: "paragraph",
        content: [styled("batch A", { inlineMaterial: "ent_curr_mat" })],
        children: [],
      });
    }
    const labels = new Map([
      ["h-prev", "procedure"],
      ["h-curr", "procedure"],
    ]);
    const links = [
      {
        id: "link-1",
        sourceBlockId: "h-curr",
        targetBlockId: "h-prev",
        type: "informed_by" as const,
        layer: "prov" as const,
        createdBy: "human" as const,
      },
    ];
    return generateProvDocument({ blocks, labels, links });
  };

  it("prev の出力が複数で一致が無ければ、勝手に選ばず synthetic 'の結果' に落とす", () => {
    const doc = buildMultiOutputDoc(false);
    const currAct = doc["@graph"].find((n) => n["@id"] === "activity_h-curr") as any;
    const usedIds = (currAct?.["prov:used"] ?? []).map((u: any) => u["@id"]);
    expect(usedIds).not.toContain("inline_output_ent_out_a");
    expect(usedIds).not.toContain("inline_output_ent_out_b");
    expect(usedIds).toContain("result_synthetic_h-prev");
  });

  it("output テーブルの行も unification の対象になる（同名の inline 入力と merge）", () => {
    const blocks: any[] = [
      { id: "h-prev", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Step A" }], children: [] },
      {
        id: "tbl-out",
        type: "table",
        content: {
          type: "tableContent",
          rows: [
            { cells: [[{ type: "text", text: "名前", styles: {} }], [{ type: "text", text: "質量", styles: {} }]] },
            { cells: [[{ type: "text", text: "batch A", styles: {} }], [{ type: "text", text: "5g", styles: {} }]] },
            { cells: [[{ type: "text", text: "batch B", styles: {} }], [{ type: "text", text: "5g", styles: {} }]] },
          ],
        },
        children: [],
      },
      { id: "h-curr", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Step B" }], children: [] },
      {
        id: "p-curr",
        type: "paragraph",
        content: [styled("batch A", { inlineMaterial: "ent_curr_mat" })],
        children: [],
      },
    ];
    const labels = new Map([
      ["h-prev", "procedure"],
      ["tbl-out", "output"],
      ["h-curr", "procedure"],
    ]);
    const links = [
      {
        id: "link-1",
        sourceBlockId: "h-curr",
        targetBlockId: "h-prev",
        type: "informed_by" as const,
        layer: "prov" as const,
        createdBy: "human" as const,
      },
    ];
    const doc = generateProvDocument({ blocks, labels, links });
    // batch A はテーブル行 Entity（result_）1 つに merge され、inline 側は消える
    const batchA = doc["@graph"].filter(
      (n) => n["@type"] === "prov:Entity" && n["rdfs:label"] === "batch A",
    );
    expect(batchA).toHaveLength(1);
    expect(batchA[0]["@id"]).toBe("result_tbl-out_batch A");
    // 行の属性（質量列）はテーブル行側に保持される
    expect((batchA[0] as any)["graphium:質量"]).toBe("5g");
    // synthetic は作られない
    expect(doc["@graph"].filter((n) => n["@id"].startsWith("result_synthetic_"))).toHaveLength(0);
    // curr は batch A（テーブル行）を used、batch B は繋がらない
    const currAct = doc["@graph"].find((n) => n["@id"] === "activity_h-curr") as any;
    const usedIds = (currAct?.["prov:used"] ?? []).map((u: any) => u["@id"]);
    expect(usedIds).toContain("result_tbl-out_batch A");
    expect(usedIds).not.toContain("result_tbl-out_batch B");
  });

  it("prev の出力が複数でも、同名の入力があれば unification でその出力だけが正確に繋がる", () => {
    const doc = buildMultiOutputDoc(true);
    // batch A は 1 Entity に merge され、synthetic は作られない
    const merged = doc["@graph"].filter(
      (n) => n["@type"] === "prov:Entity" && n["rdfs:label"] === "batch A",
    );
    expect(merged).toHaveLength(1);
    expect(doc["@graph"].filter((n) => n["@id"].startsWith("result_synthetic_"))).toHaveLength(0);
    const currAct = doc["@graph"].find((n) => n["@id"] === "activity_h-curr") as any;
    const usedIds = (currAct?.["prov:used"] ?? []).map((u: any) => u["@id"]);
    expect(usedIds).toContain("inline_output_ent_out_a");
    expect(usedIds).not.toContain("inline_output_ent_out_b");
  });
});

// ──────────────────────────────────
// 画像ブロックと PROV グラフ
//
// 画像 OCR の来歴（画像 Entity → OCR Activity → 抽出テキスト）はかつて
// 自動で手順グラフに投影していたが、ユーザーが記述した手順と無関係な
// ノイズになるため撤去した。OCR テキストは page.mediaOcr サイドストアに
// 残り、検索・素材メタデータでは使われ続ける。
// ここでは「画像ブロックだけでは PROV グラフに何も現れない」ことを
// 回帰防止として固定する。
// ──────────────────────────────────

describe("画像ブロックと PROV グラフ", () => {
  const imageBlock = () => ({
    id: "img-1",
    type: "image",
    props: { url: "blob:https://example/abc", name: "receipt.png" },
    content: undefined,
    children: [],
  });

  it("ラベルの無い画像ブロックは PROV グラフに現れない", () => {
    const doc = generateProvDocument({ blocks: [imageBlock()], labels: new Map(), links: [] });
    expect(doc["@graph"]).toHaveLength(0);
  });

  it("インラインラベル済みの画像もラベル由来 Entity のみで、OCR 由来ノードは生成されない", () => {
    const doc = generateProvDocument({
      blocks: [imageBlock()],
      labels: new Map(),
      links: [],
      mediaInlineLabels: new Map([["img-1", { label: "material" as const, entityId: "ent_material_x" }]]),
    });
    const g = doc["@graph"];
    expect(g.some((n) => n["@id"] === "inline_material_ent_material_x")).toBe(true);
    expect(
      g.some(
        (n) =>
          n["@id"].startsWith("image_") ||
          n["@id"].startsWith("activity_ocr_") ||
          n["@id"].startsWith("result_ocr_"),
      ),
    ).toBe(false);
  });
});
