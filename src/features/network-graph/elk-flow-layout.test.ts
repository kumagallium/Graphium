// elk-flow-layout.ts の単体テスト。
//
// 検証の軸: parentId 付きノードが ELK の compound layout で親（帯）の子として
// 並ぶこと（親の width/height が返る・子の座標が親の padding 以上であること）。

import { describe, expect, it } from "vitest";
import { layoutStepFlow } from "./elk-flow-layout";

describe("layoutStepFlow", () => {
  it("parentId 無しのノードは従来どおり root 直下に並ぶ", async () => {
    const positions = await layoutStepFlow(
      [
        { id: "a", width: 180, height: 48 },
        { id: "b", width: 180, height: 48 },
      ],
      [{ id: "e1", source: "a", target: "b" }],
    );
    expect(positions.get("a")).toBeTruthy();
    expect(positions.get("b")).toBeTruthy();
  });

  it("2 つの帯に 2 ノードずつ + 帯をまたぐ線があると、親の width/height が返り、子の座標は親の padding 以上になる", async () => {
    const positions = await layoutStepFlow(
      [
        // 帯ノード自身: parentId 無し・width/height 無し（仕様どおり { id } のみ）
        { id: "group:t1" },
        { id: "group:t2" },
        { id: "a1", width: 180, height: 48, parentId: "group:t1" },
        { id: "a2", width: 180, height: 48, parentId: "group:t1" },
        { id: "b1", width: 180, height: 48, parentId: "group:t2" },
        { id: "b2", width: 180, height: 48, parentId: "group:t2" },
      ],
      [
        { id: "e1", source: "a1", target: "a2" },
        { id: "e2", source: "b1", target: "b2" },
        // 帯をまたぐ線
        { id: "e3", source: "a1", target: "b1" },
      ],
    );

    const group1 = positions.get("group:t1");
    const group2 = positions.get("group:t2");
    expect(group1).toBeTruthy();
    expect(group2).toBeTruthy();
    expect(group1!.width).toBeGreaterThan(0);
    expect(group1!.height).toBeGreaterThan(0);
    expect(group2!.width).toBeGreaterThan(0);
    expect(group2!.height).toBeGreaterThan(0);

    // 子の座標は「親からの相対」で返る（ELK の出力どおり）。
    // padding "[top=40,left=16,bottom=16,right=16]" 以上の位置にあること
    for (const childId of ["a1", "a2"]) {
      const pos = positions.get(childId)!;
      expect(pos).toBeTruthy();
      expect(pos.x).toBeGreaterThanOrEqual(16);
      expect(pos.y).toBeGreaterThanOrEqual(40);
    }
    for (const childId of ["b1", "b2"]) {
      const pos = positions.get(childId)!;
      expect(pos).toBeTruthy();
      expect(pos.x).toBeGreaterThanOrEqual(16);
      expect(pos.y).toBeGreaterThanOrEqual(40);
    }
  });

  it("root 直下のノード（entity）と帯が混在しても全ノードに有限の座標が付く", async () => {
    const positions = await layoutStepFlow(
      [
        { id: "group:t1" },
        { id: "a1", width: 180, height: 48, parentId: "group:t1" },
        { id: "a2", width: 180, height: 48, parentId: "group:t1" },
        { id: "ent1", width: 160, height: 40 },
        { id: "ent2", width: 160, height: 40 },
      ],
      [
        { id: "e1", source: "a1", target: "ent1" },
        { id: "e2", source: "ent1", target: "a2" },
        { id: "e3", source: "a2", target: "ent2" },
      ],
    );
    for (const id of ["group:t1", "a1", "a2", "ent1", "ent2"]) {
      const pos = positions.get(id);
      expect(pos, id).toBeTruthy();
      expect(Number.isFinite(pos!.x) && Number.isFinite(pos!.y), id).toBe(true);
    }
    const g = positions.get("group:t1")!;
    expect(g.width).toBeGreaterThan(0);
    expect(g.height).toBeGreaterThan(0);
  });
});
