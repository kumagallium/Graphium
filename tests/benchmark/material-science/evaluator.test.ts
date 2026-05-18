import { describe, expect, it } from "vitest";
import type { ProvIngesterOutput } from "../../../src/server/services/prov-ingester";
import {
  canonicalKey,
  evaluateSample,
  extractSetsFromGold,
  extractSetsFromOutput,
  normalize,
  prf,
  type MatProvOutput,
} from "./evaluator";

const gold: MatProvOutput = [
  {
    label: "Cu_simple",
    "@graph": [
      { "@type": "Entity", "@id": "e1", label: [{ "@value": "Cu" }], type: [{ "@value": "material" }] },
      { "@type": "Entity", "@id": "e2", label: [{ "@value": "silica tube" }], type: [{ "@value": "tool" }] },
      { "@type": "Activity", "@id": "a1", label: [{ "@value": "Sealing" }], "matprov:atmosphere": [{ "@value": "vacuum" }] },
      { "@type": "Usage", activity: "a1", entity: "e1" },
      { "@type": "Usage", activity: "a1", entity: "e2" },
      { "@type": "Entity", "@id": "e3", label: [{ "@value": "sealed sample" }], type: [{ "@value": "material" }] },
      { "@type": "Generation", activity: "a1", entity: "e3" },
    ],
  },
];

const matchingOutput: ProvIngesterOutput = {
  title: "Cu_simple",
  blocks: [
    { blockType: "heading", level: 2, role: "procedure", stepId: "sealing", text: "Sealing" },
    {
      blockType: "paragraph",
      content: [
        { text: "Place " },
        { text: "Cu", role: "material" },
        { text: " in a " },
        { text: "silica tube", role: "tool" },
        { text: " under " },
        { text: "atmosphere: vacuum", role: "attribute" },
        { text: " to obtain the " },
        { text: "sealed sample", role: "output" },
        { text: "." },
      ],
    },
  ],
};

describe("normalize / canonicalKey", () => {
  it("normalize は lowercase + 句読点除去 + 空白集約", () => {
    expect(normalize("Spark Plasma Sintering!")).toBe("spark plasma sintering");
    expect(normalize("99.999 %")).toBe("99 999");
    expect(normalize("  Cu  ")).toBe("cu");
  });

  it("canonicalKey は synonym map で表記揺れを吸収する", () => {
    expect(canonicalKey("temperature")).toBe("temperature");
    expect(canonicalKey("temp")).toBe("temperature");
    expect(canonicalKey("T")).toBe("temperature");
    expect(canonicalKey("time")).toBe("duration");
    expect(canonicalKey("temperature_start")).toBe("temperature_start");
    // 未知 key は snake_case 正規化だけ
    expect(canonicalKey("Magnetic Field Strength")).toBe("magnetic_field_strength");
  });
});

describe("extractSetsFromOutput", () => {
  it("H2 procedure の text を Activity 集合に入れる", () => {
    const sets = extractSetsFromOutput(matchingOutput);
    expect(sets.activities).toEqual(["Sealing"]);
  });

  it("material/tool/output span を集合化、output は material 側に合算する", () => {
    const sets = extractSetsFromOutput(matchingOutput);
    expect(sets.materials.sort()).toEqual(["Cu", "sealed sample"].sort());
    expect(sets.tools).toEqual(["silica tube"]);
  });

  it("attribute span は key:value で parameters 集合に入る", () => {
    const sets = extractSetsFromOutput(matchingOutput);
    expect(sets.parameters).toContain(`atmosphere::vacuum`);
  });

  it("scope 内 span から Usage/Generation edge を導く", () => {
    const sets = extractSetsFromOutput(matchingOutput);
    expect(sets.edges).toContain("Usage::sealing::cu");
    expect(sets.edges).toContain("Usage::sealing::silica tube");
    expect(sets.edges).toContain("Generation::sealing::sealed sample");
  });
});

describe("evaluateSample", () => {
  it("ProvIngesterOutput と gold @graph が完全一致なら F1=1（5 集合とも）", () => {
    const m = evaluateSample("t1", [matchingOutput], gold);
    expect(prf(m.total.activities).f1).toBe(1);
    expect(prf(m.total.materials).f1).toBe(1);
    expect(prf(m.total.tools).f1).toBe(1);
    expect(prf(m.total.edges).f1).toBe(1);
    expect(prf(m.total.parameters).f1).toBe(1);
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

  it("Activity label の大文字差は normalize でマッチ扱い", () => {
    const out: ProvIngesterOutput = {
      title: "x",
      blocks: [
        { blockType: "heading", level: 2, role: "procedure", text: "SEALING" },
      ],
    };
    const m = evaluateSample("t3", [out], gold);
    expect(m.total.activities.matched).toBe(1);
  });

  it("parameter key の synonym（temp→temperature）はマッチ扱い", () => {
    const goldT: MatProvOutput = [
      {
        label: "x",
        "@graph": [
          { "@type": "Activity", "@id": "a1", label: [{ "@value": "annealing" }], "matprov:temperature": [{ "@value": "773 K" }] },
        ],
      },
    ];
    const out: ProvIngesterOutput = {
      title: "x",
      blocks: [
        { blockType: "heading", level: 2, role: "procedure", text: "annealing" },
        {
          blockType: "paragraph",
          content: [
            { text: "anneal at " },
            { text: "temp: 773 K", role: "attribute" },
          ],
        },
      ],
    };
    const m = evaluateSample("t4", [out], goldT);
    expect(m.total.parameters.matched).toBe(1);
  });
});

describe("extractSetsFromGold", () => {
  it("Entity / Activity / edge を集合化する", () => {
    const sets = extractSetsFromGold(gold);
    expect(sets.activities).toEqual(["Sealing"]);
    expect(sets.materials.sort()).toEqual(["Cu", "sealed sample"].sort());
    expect(sets.tools).toEqual(["silica tube"]);
    expect(sets.edges).toHaveLength(3); // 2 Usage + 1 Generation
    expect(sets.parameters).toContain("atmosphere::vacuum");
  });
});
