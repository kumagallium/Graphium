import { describe, expect, it } from "vitest";
import type { MatProvProcedure } from "./matprov-types";
import { matProvToProvIngester } from "./matprov-to-prov-ingester";

const simpleProcedure: MatProvProcedure = {
  label: "Cu_simple",
  "@graph": [
    { "@type": "Entity", "@id": "e1", label: [{ "@value": "Cu" }], type: [{ "@value": "material" }] },
    { "@type": "Entity", "@id": "e2", label: [{ "@value": "silica tube" }], type: [{ "@value": "tool" }] },
    { "@type": "Activity", "@id": "a1", label: [{ "@value": "sealing" }] },
    { "@type": "Entity", "@id": "e3", label: [{ "@value": "sealed sample" }], type: [{ "@value": "material" }] },
    { "@type": "Usage", activity: "a1", entity: "e1" },
    { "@type": "Usage", activity: "a1", entity: "e2" },
    { "@type": "Generation", activity: "a1", entity: "e3" },
    { "@type": "Activity", "@id": "a2", label: [{ "@value": "annealing" }], "matprov:temperature": [{ "@value": "773 K" }] },
    { "@type": "Usage", activity: "a2", entity: "e3" },
    { "@type": "Entity", "@id": "e4", label: [{ "@value": "annealed sample" }], type: [{ "@value": "material" }] },
    { "@type": "Generation", activity: "a2", entity: "e4" },
  ],
};

describe("matProvToProvIngester", () => {
  it("title は procedure.label を使う", () => {
    const out = matProvToProvIngester(simpleProcedure);
    expect(out.title).toBe("Cu_simple");
  });

  it("各 Activity ごとに H2 procedure heading を生成する", () => {
    const out = matProvToProvIngester(simpleProcedure);
    const headings = out.blocks.filter((b) => b.blockType === "heading" && b.role === "procedure");
    expect(headings).toHaveLength(2);
    expect(headings[0].text).toBe("Sealing");
    expect(headings[1].text).toBe("Annealing");
    expect(headings[0].stepId).toBe("sealing");
    expect(headings[1].stepId).toBe("annealing");
  });

  it("Usage の material/tool が paragraph 内 inline span として現れる", () => {
    const out = matProvToProvIngester(simpleProcedure);
    const sealingPara = out.blocks[2];
    expect(sealingPara.blockType).toBe("paragraph");
    const spans = sealingPara.content!;
    const materialSpan = spans.find((s) => s.role === "material");
    const toolSpan = spans.find((s) => s.role === "tool");
    expect(materialSpan?.text).toBe("Cu");
    expect(toolSpan?.text).toBe("silica tube");
  });

  it("Generation Entity が output span として現れる", () => {
    const out = matProvToProvIngester(simpleProcedure);
    const sealingPara = out.blocks[2];
    const outputSpan = sealingPara.content!.find((s) => s.role === "output");
    expect(outputSpan?.text).toBe("sealed sample");
  });

  it("別 Activity が Generation した material は derivedFrom で繋がる", () => {
    const out = matProvToProvIngester(simpleProcedure);
    const annealPara = out.blocks[4];
    const materialSpan = annealPara.content!.find((s) => s.role === "material");
    expect(materialSpan?.text).toBe("sealed sample");
    expect(materialSpan?.derivedFrom).toBe("sealing");
  });

  it("Activity の parameter は attribute span として現れる", () => {
    const out = matProvToProvIngester(simpleProcedure);
    const annealPara = out.blocks[4];
    const attrSpans = annealPara.content!.filter((s) => s.role === "attribute");
    expect(attrSpans.some((s) => s.text === "temperature: 773 K")).toBe(true);
  });

  it("stepId 重複時は番号付与", () => {
    const proc: MatProvProcedure = {
      label: "dup",
      "@graph": [
        { "@type": "Activity", "@id": "a1", label: [{ "@value": "mixing" }] },
        { "@type": "Activity", "@id": "a2", label: [{ "@value": "Mixing" }] },
      ],
    };
    const out = matProvToProvIngester(proc);
    const headings = out.blocks.filter((b) => b.blockType === "heading");
    expect(headings[0].stepId).toBe("mixing");
    expect(headings[1].stepId).toBe("mixing-2");
  });
});
