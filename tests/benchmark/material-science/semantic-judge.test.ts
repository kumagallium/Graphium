import { describe, expect, it } from "vitest";
import {
  goldGraphFromMatProv,
  parseJudgeOutput,
  predGraphFromOutput,
  scoreWithMapping,
  summarize,
} from "./semantic-judge";
import type { ProvIngesterOutput } from "../../../src/server/services/prov-ingester";

const output: ProvIngesterOutput = {
  title: "t",
  blocks: [
    { blockType: "heading", level: 2, role: "procedure", text: "Mixing", stepId: "mix" },
    {
      blockType: "paragraph",
      content: [
        { text: "BaCO3", role: "material" },
        { text: "purity: 99.9%", role: "attribute" },
        { text: "mortar", role: "tool" },
        { text: "mixed powder", role: "output" },
      ],
    },
    { blockType: "heading", level: 2, role: "procedure", text: "Calcining", stepId: "calc" },
    {
      blockType: "paragraph",
      content: [
        { text: "mixed powder", role: "material", derivedFrom: "mix" },
        { text: "temperature: 900 °C", role: "attribute", attachTo: "activity" },
        { text: "calcined powder", role: "output" },
      ],
    },
    { blockType: "heading", level: 2, role: "procedure", text: "XRD", stepId: "xrd" },
    { blockType: "paragraph", content: [{ text: "calcined powder", role: "material", derivedFrom: "calc" }, { text: "diffractometer", role: "tool" }] },
  ],
};

const gold = goldGraphFromMatProv([
  {
    label: "x",
    "@graph": [
      { "@type": "Entity", "@id": "e1", label: [{ "@value": ["BaCO3", "barium carbonate"] }], type: [{ "@value": "material" }], "matprov:purity": [{ "@value": "99.9%" }] },
      { "@type": "Entity", "@id": "e2", label: [{ "@value": "mixed sample" }], type: [{ "@value": "material" }] },
      { "@type": "Entity", "@id": "e3", label: [{ "@value": "calcined sample" }], type: [{ "@value": "material" }] },
      { "@type": "Entity", "@id": "t1", label: [{ "@value": "mortar" }], type: [{ "@value": "tool" }] },
      { "@type": "Activity", "@id": "a1", label: [{ "@value": "mixing" }] },
      { "@type": "Activity", "@id": "a2", label: [{ "@value": "calcining" }], "matprov:temperature": [{ "@value": "900 °C" }] },
      { "@type": "Usage", activity: "a1", entity: "e1" },
      { "@type": "Usage", activity: "a1", entity: "t1" },
      { "@type": "Generation", activity: "a1", entity: "e2" },
      { "@type": "Usage", activity: "a2", entity: "e2" },
      { "@type": "Generation", activity: "a2", entity: "e3" },
    ],
  },
]);

describe("predGraphFromOutput", () => {
  it("次の手順の材料が前の手順の成果物と同じ名前なら同じ実体にする（アプリのグラフと同じ）", () => {
    const g = predGraphFromOutput(output);
    expect(g.activities.map((a) => a.label)).toEqual(["Mixing", "Calcining", "XRD"]);
    const mixed = g.entities.filter((e) => e.label === "mixed powder");
    expect(mixed).toHaveLength(1);
    expect(mixed[0].role).toBe("output");
    expect(g.edges).toContainEqual(["Generation", "a1", mixed[0].id]);
    expect(g.edges).toContainEqual(["Usage", "a2", mixed[0].id]);
    // パラメータは手順と直前の実体を覚える（attachTo: activity なら実体なし）
    expect(g.params.find((p) => p.key === "purity")?.entity).toBeDefined();
    expect(g.params.find((p) => p.key === "temperature")?.entity).toBeUndefined();
  });
});

describe("scoreWithMapping", () => {
  it("対応表でつながりを正解の ID に置き換えて数え、範囲外（測定）を適合率の分母から外す", () => {
    const pred = predGraphFromOutput(output);
    const id = (label: string) => pred.entities.find((e) => e.label === label)!.id;
    const raw = JSON.stringify({
      activities: { a1: { gold: "a1", scope: "synthesis" }, a2: { gold: "a2", scope: "synthesis" }, a3: { gold: null, scope: "characterization" } },
      entities: {
        [id("BaCO3")]: { gold: "e1", scope: "synthesis" },
        [id("mortar")]: { gold: "t1", scope: "synthesis" },
        [id("mixed powder")]: { gold: "e2", scope: "synthesis" },
        [id("calcined powder")]: { gold: "e3", scope: "synthesis" },
        [id("diffractometer")]: { gold: null, scope: "characterization" },
      },
      parameters: { p1: "e1#purity", p2: "a2#temperature" },
    });
    const m = parseJudgeOutput(raw, pred, gold);
    const s = scoreWithMapping(pred, gold, m);
    expect(s.activities).toMatchObject({ tp: 2, pred: 3, predInScope: 2, gold: 2, goldHit: 2 });
    expect(s.edges.goldHit).toBe(5);
    expect(s.edges.gold).toBe(5);
    expect(summarize(s.edges).r).toBe(1);
    // XRD のつながり（calcined powder の使用・装置の使用）は範囲外
    expect(s.edges.pred - s.edges.predInScope).toBe(2);
    expect(summarize(s.edges).pIn).toBe(1);
    expect(s.parameters).toMatchObject({ tp: 2, goldHit: 2, gold: 2 });
  });

  it("予測が装置・正解が材料のように種類が食い違っても、同じ実体なら一致に数える", () => {
    const pred = predGraphFromOutput(output);
    const mortar = pred.entities.find((e) => e.label === "mortar")!.id;
    const m = parseJudgeOutput(JSON.stringify({ activities: {}, entities: { [mortar]: { gold: "e1", scope: "synthesis" } }, parameters: {} }), pred, gold);
    const s = scoreWithMapping(pred, gold, m);
    expect(s.tools.tp).toBe(1);
    expect(s.materials.goldHit).toBe(1);
  });

  it("対応表に無い ID や一覧外の正解 ID は null にする", () => {
    const pred = predGraphFromOutput(output);
    const m = parseJudgeOutput(`{"activities": {"a1": {"gold": "zz", "scope": "synthesis"}}}`, pred, gold);
    expect(m.activities.a1.gold).toBeNull();
    expect(m.activities.a3.gold).toBeNull();
  });
});
