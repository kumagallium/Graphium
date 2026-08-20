import { describe, it, expect } from "vitest";
import {
  provDocToStepGraph,
  provDocToFlowGraph,
  computeStepDistinguishers,
} from "./activity-graph-adapter";
import type { ProvJsonLd } from "../prov-generator/generator";

// 関係は node に埋め込まれる（prov:used は消費 activity 側 / prov:wasGeneratedBy は output entity 側）
function makeDoc(graph: any[]): ProvJsonLd {
  return { "@graph": graph } as unknown as ProvJsonLd;
}

describe("provDocToStepGraph", () => {
  it("output 経由の手順依存を A → B に畳む（output ノードは作らない）", () => {
    const doc = makeDoc([
      { "@id": "activity_A", "@type": "prov:Activity", "rdfs:label": "切る", "graphium:blockId": "blkA" },
      {
        "@id": "activity_B",
        "@type": "prov:Activity",
        "rdfs:label": "炒める",
        "graphium:blockId": "blkB",
        "prov:used": [{ "@id": "out_A" }],
      },
      {
        "@id": "out_A",
        "@type": "prov:Entity",
        "rdfs:label": "切ったもの",
        "prov:wasGeneratedBy": [{ "@id": "activity_A" }],
      },
    ]);

    const { activities, steps } = provDocToStepGraph(doc);
    expect(activities).toHaveLength(2);
    expect(activities[0]).toMatchObject({ id: "blkA", name: "切る" });
    expect(activities[1]).toMatchObject({ id: "blkB", name: "炒める" });
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ from: "blkA", to: "blkB" });
    // 他手順の output はエッジで表現され、B の inputs チップには載せない
    expect(activities[1].inputs).toEqual([]);
    // A の明示 output はカードに載る
    expect(activities[0].outputs).toEqual([{ label: "切ったもの", kind: "output" }]);
  });

  it("生成されていない入力 entity（材料/ツール）は手順依存にせず inputs に載せる", () => {
    const doc = makeDoc([
      {
        "@id": "activity_A",
        "@type": "prov:Activity",
        "rdfs:label": "炒める",
        "graphium:blockId": "blkA",
        "prov:used": [{ "@id": "mat_onion" }, { "@id": "tool_pan" }],
      },
      { "@id": "mat_onion", "@type": "prov:Entity", "rdfs:label": "玉ねぎ" },
      { "@id": "tool_pan", "@type": "prov:Entity", "rdfs:label": "フライパン", "graphium:entityType": "tool" },
    ]);

    const { activities, steps } = provDocToStepGraph(doc);
    expect(activities).toHaveLength(1);
    expect(steps).toHaveLength(0);
    expect(activities[0].inputs).toEqual([
      { label: "玉ねぎ", kind: "material" },
      { label: "フライパン", kind: "tool" },
    ]);
  });

  it("informed_by desugar の合成プレースホルダは inputs にも outputs にも載せない", () => {
    const doc = makeDoc([
      { "@id": "activity_A", "@type": "prov:Activity", "rdfs:label": "A", "graphium:blockId": "blkA" },
      {
        "@id": "activity_B",
        "@type": "prov:Activity",
        "rdfs:label": "B",
        "graphium:blockId": "blkB",
        "prov:used": [{ "@id": "result_synthetic_blkA" }],
      },
      {
        "@id": "result_synthetic_blkA",
        "@type": "prov:Entity",
        "rdfs:label": "A の結果",
        "prov:wasGeneratedBy": [{ "@id": "activity_A" }],
      },
    ]);

    const { activities, steps } = provDocToStepGraph(doc);
    // 手順エッジには畳む
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ from: "blkA", to: "blkB" });
    // カードには出さない
    expect(activities[0].outputs).toEqual([]);
    expect(activities[1].inputs).toEqual([]);
  });

  it("Activity 直属の graphium:* とattributes をパラメータ行として抽出する", () => {
    const doc = makeDoc([
      {
        "@id": "activity_A",
        "@type": "prov:Activity",
        "rdfs:label": "焼成",
        "graphium:blockId": "blkA",
        "graphium:temperature": "900C",
        "graphium:phase": "result", // 予約キーは除外
        "graphium:attributes": [
          { "rdfs:label": "2h", "graphium:entityId": "ent_attribute_time" },
          { "rdfs:label": "Ar 雰囲気" }, // entityId 無し（テーブル由来など）は表示のみ
        ],
      },
    ]);

    const { activities } = provDocToStepGraph(doc);
    expect(activities[0].params).toEqual([
      { label: "temperature: 900C" },
      { label: "2h", entityId: "ent_attribute_time" },
      { label: "Ar 雰囲気" },
    ]);
  });

  it("インライン span 由来の Entity は entityId を復元し、それ以外は undefined", () => {
    const doc = makeDoc([
      {
        "@id": "activity_A",
        "@type": "prov:Activity",
        "rdfs:label": "混合",
        "graphium:blockId": "blkA",
        "prov:used": [{ "@id": "inline_material_ent_material_cu" }, { "@id": "row_table_1" }],
      },
      { "@id": "inline_material_ent_material_cu", "@type": "prov:Entity", "rdfs:label": "Cu粉末" },
      { "@id": "row_table_1", "@type": "prov:Entity", "rdfs:label": "表の行" },
      {
        "@id": "inline_output_ent_output_mix",
        "@type": "prov:Entity",
        "rdfs:label": "混合粉",
        "prov:wasGeneratedBy": [{ "@id": "activity_A" }],
      },
    ]);

    const { activities } = provDocToStepGraph(doc);
    expect(activities[0].inputs).toEqual([
      { label: "Cu粉末", kind: "material", entityId: "ent_material_cu" },
      { label: "表の行", kind: "material" },
    ]);
    expect(activities[0].outputs).toEqual([
      { label: "混合粉", kind: "output", entityId: "ent_output_mix" },
    ]);
  });

  it("1 つの output が複数手順に使われると手順依存が fan-out する", () => {
    const doc = makeDoc([
      { "@id": "activity_A", "@type": "prov:Activity", "rdfs:label": "切る", "graphium:blockId": "blkA" },
      {
        "@id": "activity_B",
        "@type": "prov:Activity",
        "rdfs:label": "炒める",
        "graphium:blockId": "blkB",
        "prov:used": [{ "@id": "out_A" }],
      },
      {
        "@id": "activity_C",
        "@type": "prov:Activity",
        "rdfs:label": "煮込む",
        "graphium:blockId": "blkC",
        "prov:used": [{ "@id": "out_A" }],
      },
      {
        "@id": "out_A",
        "@type": "prov:Entity",
        "rdfs:label": "切ったもの",
        "prov:wasGeneratedBy": [{ "@id": "activity_A" }],
      },
    ]);

    const { steps } = provDocToStepGraph(doc);
    expect(steps.map((s) => `${s.from}->${s.to}`).sort()).toEqual(["blkA->blkB", "blkA->blkC"]);
  });

  it("同じ A→B が複数 output 経由でも 1 本に重複排除する", () => {
    const doc = makeDoc([
      { "@id": "activity_A", "@type": "prov:Activity", "rdfs:label": "A", "graphium:blockId": "blkA" },
      {
        "@id": "activity_B",
        "@type": "prov:Activity",
        "rdfs:label": "B",
        "graphium:blockId": "blkB",
        "prov:used": [{ "@id": "o1" }, { "@id": "o2" }],
      },
      { "@id": "o1", "@type": "prov:Entity", "rdfs:label": "o1", "prov:wasGeneratedBy": [{ "@id": "activity_A" }] },
      { "@id": "o2", "@type": "prov:Entity", "rdfs:label": "o2", "prov:wasGeneratedBy": [{ "@id": "activity_A" }] },
    ]);

    const { steps } = provDocToStepGraph(doc);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ from: "blkA", to: "blkB" });
  });

  it("null / 空ドキュメントは空を返す", () => {
    expect(provDocToStepGraph(null)).toEqual({ activities: [], steps: [] });
    expect(provDocToStepGraph(makeDoc([]))).toEqual({ activities: [], steps: [] });
  });
});

describe("provDocToFlowGraph（F 案: Entity 独立ノード）", () => {
  it("出力ごとに独立ノードになり、分岐が used/generates エッジで区別される", () => {
    const doc = makeDoc([
      { "@id": "activity_mix", "@type": "prov:Activity", "rdfs:label": "混合・分割", "graphium:blockId": "blk-mix" },
      {
        "@id": "activity_fire",
        "@type": "prov:Activity",
        "rdfs:label": "焼成",
        "graphium:blockId": "blk-fire",
        "prov:used": [{ "@id": "inline_material_ent_a2" }],
      },
      {
        "@id": "inline_output_ent_a",
        "@type": "prov:Entity",
        "rdfs:label": "バッチA",
        "prov:wasGeneratedBy": [{ "@id": "activity_mix" }],
      },
      {
        "@id": "inline_output_ent_b",
        "@type": "prov:Entity",
        "rdfs:label": "バッチB",
        "prov:wasGeneratedBy": [{ "@id": "activity_mix" }],
      },
      { "@id": "inline_material_ent_a2", "@type": "prov:Entity", "rdfs:label": "バッチA（別Entity）" },
    ]);

    const { steps, entities, edges } = provDocToFlowGraph(doc);
    expect(steps.map((s) => s.id).sort()).toEqual(["blk-fire", "blk-mix"]);
    // 出力 2 つ + 材料 1 つがそれぞれノード
    expect(entities.map((e) => `${e.kind}:${e.label}`).sort()).toEqual([
      "material:バッチA（別Entity）",
      "output:バッチA",
      "output:バッチB",
    ]);
    expect(edges.map((e) => `${e.kind}:${e.source}->${e.target}`).sort()).toEqual([
      "gen:blk-mix->inline_output_ent_a".replace("gen:", "generates:"),
      "generates:blk-mix->inline_output_ent_b",
      "used:inline_material_ent_a2->blk-fire",
    ].sort());
  });

  it("synthetic はノードにせず orderOnly エッジ（step→step）に畳む", () => {
    const doc = makeDoc([
      { "@id": "activity_A", "@type": "prov:Activity", "rdfs:label": "乾燥", "graphium:blockId": "blkA" },
      {
        "@id": "activity_B",
        "@type": "prov:Activity",
        "rdfs:label": "計量",
        "graphium:blockId": "blkB",
        "prov:used": [{ "@id": "result_synthetic_blkA" }],
      },
      {
        "@id": "result_synthetic_blkA",
        "@type": "prov:Entity",
        "rdfs:label": "乾燥 の結果",
        "prov:wasGeneratedBy": [{ "@id": "activity_A" }],
      },
    ]);

    const { entities, edges } = provDocToFlowGraph(doc);
    expect(entities).toHaveLength(0);
    expect(edges).toEqual([
      { id: "order-blkA->blkB", kind: "orderOnly", source: "blkA", target: "blkB" },
    ]);
  });

  it("Entity の属性（graphium:* 列と従属 attribute）を attrs に載せる", () => {
    const doc = makeDoc([
      { "@id": "activity_A", "@type": "prov:Activity", "rdfs:label": "混合", "graphium:blockId": "blkA", "prov:used": [{ "@id": "entity_tbl_Cu" }, { "@id": "inline_material_ent_zn" }] },
      {
        "@id": "entity_tbl_Cu",
        "@type": "prov:Entity",
        "rdfs:label": "Cu粉末",
        "graphium:purity": "99.9%",
        "graphium:mass": "7g",
      },
      {
        "@id": "inline_material_ent_zn",
        "@type": "prov:Entity",
        "rdfs:label": "Zn粉末",
        "graphium:attributes": [{ "rdfs:label": "純度: 99%", "graphium:entityId": "ent_attr_p" }],
      },
    ]);

    const { entities } = provDocToFlowGraph(doc);
    const cu = entities.find((e) => e.label === "Cu粉末")!;
    expect(cu.attrs).toEqual([{ label: "purity: 99.9%" }, { label: "mass: 7g" }]);
    expect(cu.entityId).toBeUndefined(); // テーブル行由来は本文 span 編集不可
    const zn = entities.find((e) => e.label === "Zn粉末")!;
    expect(zn.entityId).toBe("ent_zn");
    expect(zn.attrs).toEqual([{ label: "純度: 99%", entityId: "ent_attr_p" }]);
  });

  it("同一 Entity が生成され使われる場合は 1 ノードで両エッジを持つ（unification 済み）", () => {
    const doc = makeDoc([
      { "@id": "activity_A", "@type": "prov:Activity", "rdfs:label": "A", "graphium:blockId": "blkA" },
      {
        "@id": "activity_B",
        "@type": "prov:Activity",
        "rdfs:label": "B",
        "graphium:blockId": "blkB",
        "prov:used": [{ "@id": "inline_output_ent_x" }],
      },
      {
        "@id": "inline_output_ent_x",
        "@type": "prov:Entity",
        "rdfs:label": "中間体",
        "prov:wasGeneratedBy": [{ "@id": "activity_A" }],
      },
    ]);

    const { entities, edges } = provDocToFlowGraph(doc);
    expect(entities).toHaveLength(1);
    expect(entities[0].kind).toBe("output");
    expect(edges.map((e) => `${e.kind}:${e.source}->${e.target}`).sort()).toEqual([
      "generates:blkA->inline_output_ent_x",
      "used:inline_output_ent_x->blkB",
    ]);
  });

  it("null は空を返す", () => {
    expect(provDocToFlowGraph(null)).toEqual({ steps: [], entities: [], edges: [] });
  });
});

describe("テーブル行の tableRef", () => {
  const doc = (nodes: any[]) => ({ "@context": {}, "@graph": nodes }) as any;

  it("output ラベルの表の行（result_<blockId>_<行名>）も編集可能な行として扱う", () => {
    const g = provDocToFlowGraph(
      doc([
        { "@id": "activity_s1", "@type": "prov:Activity", "rdfs:label": "焼成", "graphium:blockId": "s1" },
        {
          "@id": "result_tbl-1_バッチA",
          "@type": "prov:Entity",
          "rdfs:label": "バッチA",
          "graphium:blockId": "tbl-1",
          "prov:wasGeneratedBy": [{ "@id": "activity_s1" }],
        },
      ]),
    );
    const row = g.entities.find((e) => e.label === "バッチA");
    expect(row?.tableRef).toEqual({ blockId: "tbl-1", rowName: "バッチA" });
  });

  it("output ラベルの段落（result_<blockId>）は表の行ではないので tableRef を持たない", () => {
    const g = provDocToFlowGraph(
      doc([
        { "@id": "activity_s1", "@type": "prov:Activity", "rdfs:label": "焼成", "graphium:blockId": "s1" },
        {
          "@id": "result_p1",
          "@type": "prov:Entity",
          "rdfs:label": "焼結体",
          "graphium:blockId": "p1",
          "prov:wasGeneratedBy": [{ "@id": "activity_s1" }],
        },
      ]),
    );
    expect(g.entities.find((e) => e.label === "焼結体")?.tableRef).toBeUndefined();
  });

  it("「〜の結果」placeholder は tableRef を持たない", () => {
    const g = provDocToFlowGraph(
      doc([
        { "@id": "activity_s1", "@type": "prov:Activity", "rdfs:label": "焼成", "graphium:blockId": "s1" },
        {
          "@id": "result_synthetic_s1",
          "@type": "prov:Entity",
          "rdfs:label": "焼成 の結果",
          "graphium:blockId": "s1",
          "prov:wasGeneratedBy": [{ "@id": "activity_s1" }],
        },
      ]),
    );
    expect(g.entities.find((e) => e.label.includes("の結果"))?.tableRef).toBeUndefined();
  });
});

describe("computeStepDistinguishers — 同名ステップの見分け", () => {
  const step = (id: string, name: string, params: string[]) => ({
    id,
    name,
    params: params.map((label) => ({ label })),
  });

  it("値が割れているパラメータだけを返す（全員同じ値は返さない）", () => {
    const d = computeStepDistinguishers([
      step("a", "ボールミリング", ["rpm: 300", "time: 1 h"]),
      step("b", "ボールミリング", ["rpm: 300", "time: 3 h"]),
    ]);
    expect(d.get("a")).toEqual(["time: 1 h"]);
    expect(d.get("b")).toEqual(["time: 3 h"]);
  });

  it("同名の兄弟がいなければ何も返さない", () => {
    const d = computeStepDistinguishers([
      step("a", "粉砕", ["time: 1 h"]),
      step("b", "焼結", ["time: 3 h"]),
    ]);
    expect(d.size).toBe(0);
  });

  it("片方にしか無いパラメータも区別に使う", () => {
    const d = computeStepDistinguishers([
      step("a", "焼成", ["atmosphere: Ar"]),
      step("b", "焼成", []),
    ]);
    expect(d.get("a")).toEqual(["atmosphere: Ar"]);
    expect(d.get("b")).toBeUndefined();
  });

  it("表記揺れ（823 K と 823K）は同じ値として扱う", () => {
    const d = computeStepDistinguishers([
      step("a", "熱圧成形", ["temperature: 823 K"]),
      step("b", "熱圧成形", ["temperature: 823K"]),
    ]);
    expect(d.size).toBe(0);
  });

  it("割れているキーが多くても上限で切る", () => {
    const d = computeStepDistinguishers([
      step("a", "処理", ["k1: 1", "k2: 2", "k3: 3"]),
      step("b", "処理", ["k1: 9", "k2: 8", "k3: 7"]),
    ]);
    expect(d.get("a")).toEqual(["k1: 1", "k2: 2"]);
  });

  it("キーを持たないパラメータは区別に使わない", () => {
    const d = computeStepDistinguishers([
      step("a", "粉砕", ["粗く"]),
      step("b", "粉砕", ["細かく"]),
    ]);
    expect(d.size).toBe(0);
  });
});
