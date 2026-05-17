import { describe, expect, it } from "vitest";
import type { MatProvOutput } from "../../../src/server/services/prov-ingester-profiles/matprov-types";
import { evaluateSample, normalize, prf } from "./evaluator";

const gold: MatProvOutput = [
  {
    label: "Cu_simple",
    "@graph": [
      { "@type": "Entity", "@id": "e1", label: [{ "@value": "Cu" }], type: [{ "@value": "material" }] },
      { "@type": "Entity", "@id": "e2", label: [{ "@value": "silica tube" }], type: [{ "@value": "tool" }] },
      { "@type": "Activity", "@id": "a1", label: [{ "@value": "Sealing" }] },
      { "@type": "Usage", activity: "a1", entity: "e1" },
      { "@type": "Usage", activity: "a1", entity: "e2" },
      { "@type": "Entity", "@id": "e3", label: [{ "@value": "sealed sample" }], type: [{ "@value": "material" }] },
      { "@type": "Generation", activity: "a1", entity: "e3" },
    ],
  },
];

describe("evaluator", () => {
  it("normalize は lowercase + 句読点除去 + 空白集約", () => {
    expect(normalize("Spark Plasma Sintering!")).toBe("spark plasma sintering");
    expect(normalize("99.999 %")).toBe("99 999");
    expect(normalize("  Cu  ")).toBe("cu");
  });

  it("完全一致ペアでは P=R=F1=1", () => {
    const m = evaluateSample("t1", gold, gold);
    const acts = prf(m.total.activities);
    const mats = prf(m.total.materials);
    expect(acts.precision).toBe(1);
    expect(acts.recall).toBe(1);
    expect(acts.f1).toBe(1);
    expect(mats.precision).toBe(1);
    expect(mats.recall).toBe(1);
  });

  it("予測が空のときは P=R=F1=0", () => {
    const m = evaluateSample("t2", [], gold);
    const counts = m.total.activities;
    expect(counts.matched).toBe(0);
    expect(counts.predicted).toBe(0);
    expect(counts.gold).toBe(1);
    const acts = prf(counts);
    expect(acts.precision).toBe(0);
    expect(acts.recall).toBe(0);
    expect(acts.f1).toBe(0);
  });

  it("activity label の大文字差は normalize でマッチ扱い", () => {
    const pred: MatProvOutput = [
      {
        label: "Cu_simple",
        "@graph": [{ "@type": "Activity", "@id": "x1", label: [{ "@value": "SEALING" }] }],
      },
    ];
    const m = evaluateSample("t3", pred, gold);
    expect(m.total.activities.matched).toBe(1);
  });

  it("Usage edge は (Usage, activity-label, entity-label) で比較され @id 差を吸収する", () => {
    const pred: MatProvOutput = [
      {
        label: "Cu_simple",
        "@graph": [
          { "@type": "Entity", "@id": "xCu", label: [{ "@value": "Cu" }], type: [{ "@value": "material" }] },
          { "@type": "Entity", "@id": "xTube", label: [{ "@value": "silica tube" }], type: [{ "@value": "tool" }] },
          { "@type": "Activity", "@id": "xA", label: [{ "@value": "sealing" }] },
          { "@type": "Usage", activity: "xA", entity: "xCu" },
          { "@type": "Usage", activity: "xA", entity: "xTube" },
          { "@type": "Entity", "@id": "xSeal", label: [{ "@value": "sealed sample" }], type: [{ "@value": "material" }] },
          { "@type": "Generation", activity: "xA", entity: "xSeal" },
        ],
      },
    ];
    const m = evaluateSample("t4", pred, gold);
    expect(m.total.edges.matched).toBe(3); // 2 Usage + 1 Generation
    expect(m.total.edges.gold).toBe(3);
    expect(m.total.edges.predicted).toBe(3);
  });
});
