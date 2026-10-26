// 手順の全体の試作: 材料・出力（entity）も group を持てば同じ帯に入る
import { describe, it, expect } from "vitest";
import type { Node } from "@xyflow/react";
import { bandOfNode, groupNodeIdsOf } from "./step-flow-view";
import type { FlowEntity, FlowStep } from "./activity-graph-adapter";

const group = { id: "t1", label: "生地 A", index: 0 };
const step: FlowStep = { id: "s", name: "こねる", params: [], group };
const entity: FlowEntity = { id: "e", label: "生地 A", kind: "output", attrs: [], group };

describe("帯への所属", () => {
  it("entity に group があると step と同じ帯に入る", () => {
    const sNode = { id: "s", type: "step", position: { x: 0, y: 0 }, data: { activity: step } } as Node;
    const eNode = { id: "e", type: "entity", position: { x: 0, y: 0 }, data: { entity } } as Node;
    expect(bandOfNode(eNode)).toBe("group:t1");
    expect(bandOfNode(eNode)).toBe(bandOfNode(sNode));
  });

  it("group が無い entity は帯に入らず、帯 id は entity だけの帯も集める", () => {
    const plain = { id: "e2", type: "entity", position: { x: 0, y: 0 }, data: { entity: { ...entity, group: undefined } } } as Node;
    expect(bandOfNode(plain)).toBeNull();
    expect(groupNodeIdsOf({ steps: [], entities: [entity, entity] })).toEqual(["group:t1"]);
  });
});
