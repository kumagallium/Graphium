// 予定の線の始点解決（アウトプットのポートから引いたときの遡り）
import { describe, expect, it } from "vitest";
import { plannedSourceId } from "./planned-edge-source";
import type { FlowEdge } from "./activity-graph-adapter";

const edges: FlowEdge[] = [
  { id: "generates:note:A#out1", kind: "generates", source: "note:A", target: "note:A#out1" },
  { id: "generates:note:B#out2", kind: "generates", source: "note:B", target: "note:B#out2" },
  { id: "used:note:A#out1", kind: "used", source: "note:A#out1", target: "note:B" },
];

describe("plannedSourceId", () => {
  it("工程のポートから引いたときはその工程がそのまま始点", () => {
    expect(plannedSourceId(edges, "note:A", undefined)).toBe("note:A");
  });

  it("アウトプットのポートから引いたら、その出力を生成した工程まで遡る", () => {
    expect(plannedSourceId(edges, "note:A#out1", { id: "note:A#out1" })).toBe("note:A");
    expect(plannedSourceId(edges, "note:B#out2", { id: "note:B#out2" })).toBe("note:B");
  });

  it("遡るのは generates のみ。used の向き（出力 → 工程）を始点に取り違えない", () => {
    // used も出力を source に持つが、これを拾うと受け取り側の工程が始点になってしまう
    expect(plannedSourceId(edges, "note:A#out1", { id: "note:A#out1" })).not.toBe("note:B");
  });

  it("生成元が計画の外にあって遡れないアウトプットは始点にできない", () => {
    const orphan: FlowEdge[] = [
      { id: "used:x", kind: "used", source: "note:X#out", target: "note:B" },
    ];
    expect(plannedSourceId(orphan, "note:X#out", { id: "note:X#out" })).toBeNull();
  });
});
