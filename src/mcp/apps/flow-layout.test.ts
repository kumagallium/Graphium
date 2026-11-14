import { describe, expect, it } from "vitest";

import { flowPositions, flowRanks } from "./flow-layout";

describe("flowRanks", () => {
  it("材料 → 手順 → 生成物 → 次の手順を左から右の段に並べる（手順を同じ段に積まない）", () => {
    const nodes = [
      { id: "flour", kind: "material" },
      { id: "oven", kind: "tool" },
      { id: "knead", kind: "step" },
      { id: "dough", kind: "output" },
      { id: "bake", kind: "step" },
      { id: "bread", kind: "output" },
    ];
    const edges = [
      { source: "flour", target: "knead" },
      { source: "knead", target: "dough" },
      { source: "dough", target: "bake" },
      { source: "oven", target: "bake" },
      { source: "knead", target: "bake" },
      { source: "bake", target: "bread" },
    ];
    const r = flowRanks(nodes, edges);
    expect(r.get("knead")).toBeLessThan(r.get("bake")!);
    expect(r.get("dough")).toBeLessThan(r.get("bake")!);
    expect(r.get("bread")).toBeGreaterThan(r.get("bake")!);
    // 装置は使う手順のすぐ左（左端に集めない）
    expect(r.get("oven")).toBe(r.get("bake")! - 1);
    expect(r.get("flour")).toBe(r.get("knead")! - 1);
  });

  it("輪があっても止まり、すべてのノードに位置を返す", () => {
    const nodes = [{ id: "a", kind: "step" }, { id: "b", kind: "step" }, { id: "c", kind: "output" }];
    const edges = [{ source: "a", target: "b" }, { source: "b", target: "a" }, { source: "b", target: "c" }];
    const pos = flowPositions(nodes, edges);
    expect(pos.size).toBe(3);
  });
});
