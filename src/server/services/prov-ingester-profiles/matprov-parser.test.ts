import { describe, expect, it } from "vitest";
import { parseMatProvOutput } from "./matprov-parser";

describe("parseMatProvOutput", () => {
  it("配列 + 1 procedure をそのまま受け取る", () => {
    const raw = JSON.stringify([
      {
        label: "Cu_simple",
        "@graph": [
          { "@type": "Entity", "@id": "e1", label: [{ "@value": "Cu" }], type: [{ "@value": "material" }] },
          { "@type": "Activity", "@id": "a1", label: [{ "@value": "sealing" }] },
          { "@type": "Usage", activity: "a1", entity: "e1" },
        ],
      },
    ]);
    const out = parseMatProvOutput(raw);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("Cu_simple");
    expect(out[0]["@graph"]).toHaveLength(3);
  });

  it("単一 object を 1 要素配列として扱う", () => {
    const raw = JSON.stringify({
      label: "x",
      "@graph": [{ "@type": "Activity", "@id": "a1", label: [{ "@value": "mixing" }] }],
    });
    const out = parseMatProvOutput(raw);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("x");
  });

  it("```json でラップされた出力を解凍する", () => {
    const raw = '```json\n[{"label":"y","@graph":[{"@type":"Activity","@id":"a1"}]}]\n```';
    const out = parseMatProvOutput(raw);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("y");
  });

  it("不正な @id を持つ node は捨てる", () => {
    const raw = JSON.stringify([
      {
        label: "z",
        "@graph": [
          { "@type": "Activity", "@id": "<bad id>" },
          { "@type": "Activity", "@id": "a1", label: [{ "@value": "ok" }] },
        ],
      },
    ]);
    const out = parseMatProvOutput(raw);
    expect(out[0]["@graph"]).toHaveLength(1);
  });

  it("matprov:* parameter を保持する", () => {
    const raw = JSON.stringify([
      {
        label: "p",
        "@graph": [
          {
            "@type": "Activity",
            "@id": "a1",
            label: [{ "@value": "annealing" }],
            "matprov:temperature": [{ "@value": "773 K" }],
            "matprov:duration": [{ "@value": "5 d" }],
          },
        ],
      },
    ]);
    const out = parseMatProvOutput(raw);
    const a = out[0]["@graph"][0] as Record<string, unknown>;
    expect(a["matprov:temperature"]).toEqual([{ "@value": "773 K" }]);
    expect(a["matprov:duration"]).toEqual([{ "@value": "5 d" }]);
  });

  it("壊れた JSON は空配列を返す", () => {
    expect(parseMatProvOutput("{not json")).toEqual([]);
  });
});
