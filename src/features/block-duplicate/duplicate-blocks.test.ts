import { describe, it, expect } from "vitest";
import { stripBlockIds } from "./duplicate-blocks";
import { computeIdMap, flattenBlockIds } from "../block-lifecycle/clipboard";

describe("stripBlockIds", () => {
  it("ブロックと子孫の id を落とす", () => {
    const block = {
      id: "a",
      type: "step",
      props: { level: 1 },
      content: [{ type: "text", text: "手順" }],
      children: [
        { id: "b", type: "paragraph", content: [], children: [] },
        {
          id: "c",
          type: "bulletListItem",
          content: [],
          children: [{ id: "d", type: "paragraph", content: [], children: [] }],
        },
      ],
    };

    const copy = stripBlockIds(block);

    expect(copy.id).toBeUndefined();
    expect(copy.children[0].id).toBeUndefined();
    expect(copy.children[1].children[0].id).toBeUndefined();
    // 本文・props は保持する
    expect(copy.type).toBe("step");
    expect(copy.props).toEqual({ level: 1 });
    expect(copy.content).toEqual([{ type: "text", text: "手順" }]);
  });

  it("元のブロックを書き換えない（deep copy）", () => {
    const block = { id: "a", type: "paragraph", children: [{ id: "b", type: "paragraph" }] };
    stripBlockIds(block);
    expect(block.id).toBe("a");
    expect(block.children[0].id).toBe("b");
  });
});

describe("複製の ID 対応付け", () => {
  it("深さ優先の順序で旧 ID → 新 ID を対応付ける", () => {
    const source = [
      {
        id: "a",
        children: [{ id: "b", children: [] }],
      },
    ];
    const inserted = [
      {
        id: "a2",
        children: [{ id: "b2", children: [] }],
      },
    ];

    const idMap = computeIdMap(flattenBlockIds(source), flattenBlockIds(inserted));

    expect(idMap.get("a")).toBe("a2");
    expect(idMap.get("b")).toBe("b2");
  });
});
