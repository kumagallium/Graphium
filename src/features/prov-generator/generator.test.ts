import { describe, it, expect } from "vitest";
import { generateProvDocument, extractRelations, parseStructuredTable } from "./generator";

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
  ["h2-cut", "[手順]"],
  ["used-vegs", "[使用したもの]"],
  ["h2-fry", "[手順]"],
  ["cond-fire", "[属性]"],
  ["h2-simmer", "[手順]"],
  ["result-curry", "[結果]"],
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
    expect(activities.map((a) => a["rdfs:label"])).toEqual([
      "1. 具材を切る",
      "2. 炒める",
      "3. 煮込む",
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
  ["h2-cut", "[手順]"],
  ["used-carrot", "[使用したもの]"],
  ["used-memo", "[使用したもの]"],
  ["h2-fry", "[手順]"],
  ["cond-fire", "[属性]"],
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
      ["h2-step", "[手順]"],
      ["used-item", "[使用したもの]"],
      ["used-orphan", "[使用したもの]"],
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
      ["h2-step", "[手順]"],
      ["used-detail-item", "[使用したもの]"],
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
  ["h2-a", "[手順]"],
  ["used-mat1", "[使用したもの]"],
  ["h3-a1", "[手順]"],
  ["used-mat2", "[使用したもの]"],
  ["result-a1", "[結果]"],
  ["h3-a2", "[手順]"],
  ["param-a2", "[属性]"],
  ["result-a2", "[結果]"],
  ["h2-b", "[手順]"],
  ["used-mat3", "[使用したもの]"],
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
      ["h2-parent", "[手順]"],
      ["h3-sub", "[手順]"],
      ["used-in-sub", "[使用したもの]"],
      ["used-after-note", "[使用したもの]"],
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
      ["h2-mix", "[手順]"],
      ["mat-table", "[使用したもの]"],
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
      ["h2-eval", "[手順]"],
      ["res-table", "[結果]"],
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
      ["h2-step", "[手順]"],
      ["used-para", "[使用したもの]"],
    ]);

    const doc = generateProvDocument({ blocks, labels, links: [] });
    const entity = doc["@graph"].find((n) => n["@id"] === "entity_used-para");
    expect(entity).toBeDefined();
    expect(entity!["rdfs:label"]).toBe("Cu粉末 1g");
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
      ["h2-fry", "[手順]"],
      ["cond-fire", "[属性]"],
      ["h2-simmer", "[手順]"],
      ["result-curry", "[結果]"],
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
      ["h2-fry", "[手順]"],
      ["cond-fire", "[属性]"],
      ["h2-simmer", "[手順]"],
      ["result-curry", "[結果]"],
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
      ["h2-cut", "[手順]"],
      ["used-vegs", "[材料]"],
      ["h2-simmer", "[手順]"],
      ["result-curry", "[結果]"],
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
