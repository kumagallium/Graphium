import { describe, it, expect } from "vitest";
import { generateProvDocument } from "./generator";

// ──────────────────────────────────
// シナリオ 1: カレー実験（基本形）
//
// H2 [手順] 1. 具材を切る
//   [使用したもの] にんじん、じゃがいも
// H2 [手順] 2. 炒める
//   前手順: @1. 具材を切る
//   [条件] 中火 5分
// H2 [手順] 3. 煮込む
//   前手順: @2. 炒める
//   [結果] カレー完成
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
    expect(activities.map((a) => a.label)).toEqual([
      "1. 具材を切る",
      "2. 炒める",
      "3. 煮込む",
    ]);
  });

  it("[使用したもの] が Entity として生成される", () => {
    const doc = generateProvDocument({ blocks: curryBlocks, labels: curryLabels, links: curryLinks });
    const entities = doc["@graph"].filter((n) => n["@type"] === "prov:Entity");
    expect(entities.some((e) => e.label === "にんじん、じゃがいも")).toBe(true);
  });

  it("[条件] が prov:Entity（属性）として生成される", () => {
    const doc = generateProvDocument({ blocks: curryBlocks, labels: curryLabels, links: curryLinks });
    const params = doc["@graph"].filter((n) => n["@id"].startsWith("param_"));
    expect(params).toHaveLength(1);
    expect(params[0]["@type"]).toBe("prov:Entity");
    expect(params[0].label).toBe("中火 5分");
  });

  it("[結果] が Entity として生成される", () => {
    const doc = generateProvDocument({ blocks: curryBlocks, labels: curryLabels, links: curryLinks });
    const entities = doc["@graph"].filter((n) => n["@type"] === "prov:Entity");
    expect(entities.some((e) => e.label === "カレー完成")).toBe(true);
  });

  it("前手順リンクが結果Entity経由の used として生成される", () => {
    const doc = generateProvDocument({ blocks: curryBlocks, labels: curryLabels, links: curryLinks });
    // 前手順リンクは wasInformedBy ではなく、結果Entity経由の used になる
    // 結果がない場合は合成結果ノード + wasGeneratedBy + used が生成される
    const usedRels = doc.relations.filter((r) => r["@type"] === "prov:used");
    // [使用したもの] の used 1つ + 前手順リンク由来の used 2つ
    expect(usedRels.length).toBeGreaterThanOrEqual(3);
  });

  it("警告が出ない", () => {
    const doc = generateProvDocument({ blocks: curryBlocks, labels: curryLabels, links: curryLinks });
    expect(doc.warnings).toHaveLength(0);
  });
});

// ──────────────────────────────────
// シナリオ 2: 複数試料（Cu粉末アニール）
//
// H2 [手順] 1. 封入する
//   [使用したもの] Cu粉末テーブル
// H2 [手順] 2. アニールする
//   前手順: @1. 封入する
//   [試料] テーブル（3試料）
// H2 [手順] 3. 評価する
//   前手順: @2. アニールする
//   [結果] テーブル
// ──────────────────────────────────

const annealBlocks = [
  {
    id: "h2-seal",
    type: "heading",
    props: { level: 2 },
    content: [{ type: "text", text: "1. 封入する" }],
    children: [],
  },
  {
    id: "used-cu",
    type: "paragraph",
    content: [{ type: "text", text: "Cu粉末 1g、シリカ管" }],
    children: [],
  },
  {
    id: "h2-anneal",
    type: "heading",
    props: { level: 2 },
    content: [{ type: "text", text: "2. アニールする" }],
    children: [],
  },
  {
    id: "sample-table",
    type: "table",
    content: {
      type: "tableContent",
      rows: [
        { cells: [[{ type: "text", text: "試料名" }], [{ type: "text", text: "温度" }], [{ type: "text", text: "時間" }]] },
        { cells: [[{ type: "text", text: "sample_A" }], [{ type: "text", text: "600℃" }], [{ type: "text", text: "24h" }]] },
        { cells: [[{ type: "text", text: "sample_B" }], [{ type: "text", text: "700℃" }], [{ type: "text", text: "24h" }]] },
        { cells: [[{ type: "text", text: "sample_C" }], [{ type: "text", text: "800℃" }], [{ type: "text", text: "24h" }]] },
      ],
    },
    children: [],
  },
  {
    id: "h2-eval",
    type: "heading",
    props: { level: 2 },
    content: [{ type: "text", text: "3. 評価する" }],
    children: [],
  },
  {
    id: "result-table",
    type: "table",
    content: {
      type: "tableContent",
      rows: [
        { cells: [[{ type: "text", text: "試料名" }], [{ type: "text", text: "観察結果" }]] },
        { cells: [[{ type: "text", text: "sample_A" }], [{ type: "text", text: "相転移あり" }]] },
        { cells: [[{ type: "text", text: "sample_B" }], [{ type: "text", text: "変化なし" }]] },
        { cells: [[{ type: "text", text: "sample_C" }], [{ type: "text", text: "微小変化" }]] },
      ],
    },
    children: [],
  },
];

const annealLabels = new Map([
  ["h2-seal", "[手順]"],
  ["used-cu", "[使用したもの]"],
  ["h2-anneal", "[手順]"],
  ["sample-table", "[試料]"],
  ["h2-eval", "[手順]"],
  ["result-table", "[結果]"],
]);

const annealLinks = [
  { id: "link-a1", sourceBlockId: "h2-anneal", targetBlockId: "h2-seal", type: "informed_by" as const, layer: "prov" as const, createdBy: "human" as const },
  { id: "link-a2", sourceBlockId: "h2-eval", targetBlockId: "h2-anneal", type: "informed_by" as const, layer: "prov" as const, createdBy: "human" as const },
];

// ──────────────────────────────────
// シナリオ 1.5: スコープ境界テスト
//
// H2 [手順] 1. 具材を切る
//   [使用したもの] にんじん      ← スコープ内
// H2 (ラベルなし) 補足事項
//   [使用したもの] メモ          ← スコープ外（Activityに紐づかない）
// H2 [手順] 2. 炒める
//   [条件] 中火                  ← 新スコープ内
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
  // h2-note にはラベルなし
  ["used-memo", "[使用したもの]"],
  ["h2-fry", "[手順]"],
  ["cond-fire", "[属性]"],
]);

describe("スコープ境界テスト", () => {
  it("ラベルなしH2がスコープを切る — [使用したもの] が前のActivityに紐づかない", () => {
    const doc = generateProvDocument({ blocks: scopeBlocks, labels: scopeLabels, links: [] });

    // [使用したもの]「にんじん」は h2-cut の Activity に紐づく
    const carrotUsed = doc.relations.filter(
      (r) => r["@type"] === "prov:used" && r.to === "entity_used-carrot"
    );
    expect(carrotUsed).toHaveLength(1);
    expect(carrotUsed[0].from).toBe("activity_h2-cut");

    // [使用したもの]「メモ」はどのActivityにも紐づかない（スコープ外）
    const memoUsed = doc.relations.filter(
      (r) => r["@type"] === "prov:used" && r.to === "entity_used-memo"
    );
    expect(memoUsed).toHaveLength(0);
  });

  it("[条件] は新しいH2 [手順] のスコープに紐づく", () => {
    const doc = generateProvDocument({ blocks: scopeBlocks, labels: scopeLabels, links: [] });
    const paramRels = doc.relations.filter(
      (r) => r["@type"] === "provnote:hasAttribute" && r.to === "param_cond-fire"
    );
    expect(paramRels).toHaveLength(1);
    expect(paramRels[0].from).toBe("activity_h2-fry");
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

    // H1後の [使用したもの] はスコープ外
    const orphanUsed = doc.relations.filter(
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

    // ラベルなしH3後でもスコープ内 — 親H2 Activity に紐づく
    const detailUsed = doc.relations.filter(
      (r) => r["@type"] === "prov:used" && r.to === "entity_used-detail-item"
    );
    expect(detailUsed).toHaveLength(1);
    expect(detailUsed[0].from).toBe("activity_h2-step");
  });
});

// ──────────────────────────────────
// シナリオ 3: 見出しレベル階層スコープ
//
// H2 [手順] Step A
//   [使用したもの] Material 1       ← Step A スコープ
//   H3 [手順] Sub-step A.1
//     [使用したもの] Material 2     ← Sub-step A.1 スコープ
//     [結果] Result A.1
//   H3 [手順] Sub-step A.2
//     [属性] Param A.2
//     [結果] Result A.2
// H2 [手順] Step B
//   [使用したもの] Material 3       ← Step B スコープ
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
    expect(activities.map((a) => a.label)).toEqual([
      "Step A",
      "Sub-step A.1",
      "Sub-step A.2",
      "Step B",
    ]);
  });

  it("H2直下の [使用したもの] は H2 Activity にスコープされる", () => {
    const doc = generateProvDocument({ blocks: hierarchyBlocks, labels: hierarchyLabels, links: [] });
    const mat1Used = doc.relations.filter(
      (r) => r["@type"] === "prov:used" && r.to === "entity_used-mat1"
    );
    expect(mat1Used).toHaveLength(1);
    expect(mat1Used[0].from).toBe("activity_h2-a");
  });

  it("H3直下の [使用したもの] は H3 サブActivity にスコープされる", () => {
    const doc = generateProvDocument({ blocks: hierarchyBlocks, labels: hierarchyLabels, links: [] });
    const mat2Used = doc.relations.filter(
      (r) => r["@type"] === "prov:used" && r.to === "entity_used-mat2"
    );
    expect(mat2Used).toHaveLength(1);
    expect(mat2Used[0].from).toBe("activity_h3-a1");
  });

  it("[結果] は対応するH3サブActivityにスコープされる", () => {
    const doc = generateProvDocument({ blocks: hierarchyBlocks, labels: hierarchyLabels, links: [] });
    const resultA1 = doc.relations.filter(
      (r) => r["@type"] === "prov:wasGeneratedBy" && r.from === "result_result-a1"
    );
    expect(resultA1).toHaveLength(1);
    expect(resultA1[0].to).toBe("activity_h3-a1");

    const resultA2 = doc.relations.filter(
      (r) => r["@type"] === "prov:wasGeneratedBy" && r.from === "result_result-a2"
    );
    expect(resultA2).toHaveLength(1);
    expect(resultA2[0].to).toBe("activity_h3-a2");
  });

  it("[属性] は H3 サブActivity にスコープされる", () => {
    const doc = generateProvDocument({ blocks: hierarchyBlocks, labels: hierarchyLabels, links: [] });
    const paramRels = doc.relations.filter(
      (r) => r["@type"] === "provnote:hasAttribute" && r.to === "param_param-a2"
    );
    expect(paramRels).toHaveLength(1);
    expect(paramRels[0].from).toBe("activity_h3-a2");
  });

  it("次のH2で全スコープがリセットされる", () => {
    const doc = generateProvDocument({ blocks: hierarchyBlocks, labels: hierarchyLabels, links: [] });
    const mat3Used = doc.relations.filter(
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
      // h3-note にはラベルなし → サブActivityスコープを pop、親H2スコープに戻る
      ["used-after-note", "[使用したもの]"],
    ]);

    const doc = generateProvDocument({ blocks: blocksWithUnlabeledH3, labels: labelsWithUnlabeledH3, links: [] });

    // サブステップ内の材料はサブActivityにスコープ
    const subUsed = doc.relations.filter(
      (r) => r["@type"] === "prov:used" && r.to === "entity_used-in-sub"
    );
    expect(subUsed).toHaveLength(1);
    expect(subUsed[0].from).toBe("activity_h3-sub");

    // ラベルなしH3後の材料は親H2 Activityにスコープ
    const afterNoteUsed = doc.relations.filter(
      (r) => r["@type"] === "prov:used" && r.to === "entity_used-after-note"
    );
    expect(afterNoteUsed).toHaveLength(1);
    expect(afterNoteUsed[0].from).toBe("activity_h2-parent");
  });
});

describe("複数試料シナリオ（Cu粉末アニール）", () => {
  it("アニールする が3つのActivityに分岐する", () => {
    const doc = generateProvDocument({ blocks: annealBlocks, labels: annealLabels, links: annealLinks });
    const annealActivities = doc["@graph"].filter(
      (n) => n["@type"] === "prov:Activity" && n.blockId === "h2-anneal"
    );
    expect(annealActivities).toHaveLength(3);
    expect(annealActivities.map((a) => a.sampleId)).toEqual(["sample_A", "sample_B", "sample_C"]);
  });

  it("評価する も3つに伝播する", () => {
    const doc = generateProvDocument({ blocks: annealBlocks, labels: annealLabels, links: annealLinks });
    const evalActivities = doc["@graph"].filter(
      (n) => n["@type"] === "prov:Activity" && n.blockId === "h2-eval"
    );
    expect(evalActivities).toHaveLength(3);
  });

  it("試料Entityが3つ生成される", () => {
    const doc = generateProvDocument({ blocks: annealBlocks, labels: annealLabels, links: annealLinks });
    const sampleEntities = doc["@graph"].filter(
      (n) => n["@type"] === "prov:Entity" && n.blockId === "sample-table"
    );
    expect(sampleEntities).toHaveLength(3);
    expect(sampleEntities[0].params).toEqual({ "温度": "600℃", "時間": "24h" });
  });

  it("used 関係が生成される（試料3 + 使用したもの1）", () => {
    const doc = generateProvDocument({ blocks: annealBlocks, labels: annealLabels, links: annealLinks });
    const usedRels = doc.relations.filter((r) => r["@type"] === "prov:used");
    // 試料テーブルから3つ + [使用したもの]→封入するActivity で1つ = 4つ
    expect(usedRels.length).toBeGreaterThanOrEqual(4);
  });

  it("前手順リンクが結果Entity経由で繋がる", () => {
    const doc = generateProvDocument({ blocks: annealBlocks, labels: annealLabels, links: annealLinks });
    // 前手順リンクは結果Entity経由の used に変換される
    const usedRels = doc.relations.filter((r) => r["@type"] === "prov:used");
    expect(usedRels.length).toBeGreaterThanOrEqual(4);
  });

  it("試料別分割 — 全試料で同じグラフ構造（ノード数・エッジ数が一致）", () => {
    const doc = generateProvDocument({ blocks: annealBlocks, labels: annealLabels, links: annealLinks });

    // 試料ID一覧を抽出
    const sampleIds = [...new Set(
      doc["@graph"].filter((n) => n.sampleId).map((n) => n.sampleId!)
    )].sort();
    expect(sampleIds).toEqual(["sample_A", "sample_B", "sample_C"]);

    // 共通ノード（sampleId なし）
    const commonNodes = doc["@graph"].filter((n) => !n.sampleId);

    // 各試料のサブグラフを構築
    const splits = sampleIds.map((sid) => {
      const sampleNodes = doc["@graph"].filter((n) => n.sampleId === sid);
      const graphNodes = [...commonNodes, ...sampleNodes];
      const nodeIdSet = new Set(graphNodes.map((n) => n["@id"]));
      const filteredRelations = doc.relations.filter(
        (r) => nodeIdSet.has(r.from) && nodeIdSet.has(r.to)
      );
      return { sampleId: sid, nodeCount: graphNodes.length, edgeCount: filteredRelations.length };
    });

    // 全試料でノード数・エッジ数が一致するべき
    const first = splits[0];
    for (const s of splits) {
      expect(s.nodeCount).toBe(first.nodeCount);
      expect(s.edgeCount).toBe(first.edgeCount);
    }
  });

  it("試料別分割 — 各グラフが連結している（孤立ノードなし）", () => {
    const doc = generateProvDocument({ blocks: annealBlocks, labels: annealLabels, links: annealLinks });

    const sampleIds = [...new Set(
      doc["@graph"].filter((n) => n.sampleId).map((n) => n.sampleId!)
    )].sort();
    const commonNodes = doc["@graph"].filter((n) => !n.sampleId);

    for (const sid of sampleIds) {
      const sampleNodes = doc["@graph"].filter((n) => n.sampleId === sid);
      const graphNodes = [...commonNodes, ...sampleNodes];
      const nodeIdSet = new Set(graphNodes.map((n) => n["@id"]));
      const filteredRelations = doc.relations.filter(
        (r) => nodeIdSet.has(r.from) && nodeIdSet.has(r.to)
      );

      // 各ノードが少なくとも1つのエッジに接続しているか
      const connectedIds = new Set<string>();
      for (const r of filteredRelations) {
        connectedIds.add(r.from);
        connectedIds.add(r.to);
      }
      const orphans = graphNodes.filter((n) => !connectedIds.has(n["@id"]));
      expect(orphans.map((n) => `${n["@id"]} (${sid})`)).toEqual([]);
    }
  });
});
