import { describe, it, expect } from "vitest";
import { provDocToActivityGraph } from "./activity-graph-adapter";
import type { ProvJsonLd } from "../prov-generator/generator";

// 関係は node に埋め込まれる（prov:used は消費 activity 側 / prov:wasGeneratedBy は output entity 側）
function makeDoc(graph: any[]): ProvJsonLd {
  return { "@graph": graph } as unknown as ProvJsonLd;
}

describe("provDocToActivityGraph", () => {
  it("activity / output / used を抽出し、output 経由のチェーンに変換する", () => {
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

    const { activities, outputs, uses } = provDocToActivityGraph(doc);

    // activity は blockId に正規化される
    expect(activities).toEqual([
      { id: "blkA", name: "切る" },
      { id: "blkB", name: "炒める" },
    ]);
    // output は所有 activity（blockId）に紐づく
    expect(outputs).toEqual([{ id: "out_A", owner: "blkA", label: "切ったもの" }]);
    // used は output → 消費 activity（blockId）
    expect(uses).toHaveLength(1);
    expect(uses[0]).toMatchObject({ outputId: "out_A", consumer: "blkB" });
  });

  it("生成されていない入力 entity（材料/ツール）は used から除外する", () => {
    const doc = makeDoc([
      {
        "@id": "activity_A",
        "@type": "prov:Activity",
        "rdfs:label": "炒める",
        "graphium:blockId": "blkA",
        // 材料 entity を used しているが、これは wasGeneratedBy を持たない外部入力
        "prov:used": [{ "@id": "mat_onion" }],
      },
      { "@id": "mat_onion", "@type": "prov:Entity", "rdfs:label": "玉ねぎ" },
    ]);

    const { activities, outputs, uses } = provDocToActivityGraph(doc);
    expect(activities).toHaveLength(1);
    expect(outputs).toHaveLength(0);
    expect(uses).toHaveLength(0); // 材料は output ではないので描かない
  });

  it("1 つの output が複数 activity に used される（fan-out）", () => {
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

    const { outputs, uses } = provDocToActivityGraph(doc);
    expect(outputs).toHaveLength(1); // output は 1 つのまま
    expect(uses.map((u) => u.consumer).sort()).toEqual(["blkB", "blkC"]);
  });

  it("null / 空ドキュメントは空を返す", () => {
    expect(provDocToActivityGraph(null)).toEqual({ activities: [], outputs: [], uses: [] });
    expect(provDocToActivityGraph(makeDoc([]))).toEqual({ activities: [], outputs: [], uses: [] });
  });
});
