import { describe, it, expect } from "vitest";
import { diffSteps, nextPath, type StackNode } from "./lineage-stack-model";

function proc(id: string, steps?: string[]): StackNode {
  return {
    id,
    title: id,
    kind: "proc",
    groups: [],
    links: [],
    steps: steps?.map((name) => ({ name })),
  };
}

describe("diffSteps", () => {
  it("省略だけ", () => {
    expect(diffSteps(proc("p", ["a", "b", "c"]), proc("c", ["a", "c"]))).toEqual({
      omitted: ["b"],
      added: [],
    });
  });
  it("追加だけ", () => {
    expect(diffSteps(proc("p", ["a"]), proc("c", ["a", "d"]))).toEqual({
      omitted: [],
      added: ["d"],
    });
  });
  it("省略と追加の両方", () => {
    expect(diffSteps(proc("p", ["a", "b", "c"]), proc("c", ["a", "c", "d"]))).toEqual({
      omitted: ["b"],
      added: ["d"],
    });
  });
  it("steps が無ければ null", () => {
    expect(diffSteps(proc("p"), proc("c", ["a"]))).toBeNull();
    expect(diffSteps(proc("p", ["a"]), proc("c"))).toBeNull();
  });
  it("共通の手順が無ければ null（計画 → 工程のような別物は比べない）", () => {
    expect(diffSteps(proc("p", ["a", "b"]), proc("c", ["x", "y"]))).toBeNull();
  });
});

describe("nextPath", () => {
  it("末尾の段で札を開く", () => {
    expect(nextPath(["r", "a"], 1, "b")).toEqual(["r", "a", "b"]);
  });
  it("同じ札をもう一度押すと閉じる", () => {
    expect(nextPath(["r", "a", "b"], 1, "b")).toEqual(["r", "a"]);
  });
  it("途中の段で別の札に切り替える", () => {
    expect(nextPath(["r", "a", "b", "c"], 0, "x")).toEqual(["r", "x"]);
  });
});
