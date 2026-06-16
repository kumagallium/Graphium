import { describe, it, expect } from "vitest";
import { provDocToStepGraph } from "./activity-graph-adapter";
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
    expect(activities).toEqual([
      { id: "blkA", name: "切る" },
      { id: "blkB", name: "炒める" },
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ from: "blkA", to: "blkB" });
  });

  it("生成されていない入力 entity（材料/ツール）は手順依存にしない", () => {
    const doc = makeDoc([
      {
        "@id": "activity_A",
        "@type": "prov:Activity",
        "rdfs:label": "炒める",
        "graphium:blockId": "blkA",
        "prov:used": [{ "@id": "mat_onion" }],
      },
      { "@id": "mat_onion", "@type": "prov:Entity", "rdfs:label": "玉ねぎ" },
    ]);

    const { activities, steps } = provDocToStepGraph(doc);
    expect(activities).toHaveLength(1);
    expect(steps).toHaveLength(0);
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
