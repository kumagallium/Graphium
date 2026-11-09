// @vitest-environment jsdom
// 系譜の 1 本線: 元 → いま → ここから作ったもの の並びと、押したときの注目の移り方

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { LineageFlowView } from "./lineage-flow-view";
import type { LineageStackModel, StackNode } from "./lineage-stack-model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 図（React Flow）は jsdom で動かさない
vi.mock("./step-flow-view", () => ({
  StepFlowView: () => <div data-testid="step-flow" />,
  PLANNED_COLOR: "#000",
  PLAN_AS_PLANNED_COLOR: "#000",
  PLAN_UNPLANNED_COLOR: "#000",
}));

afterEach(cleanup);

function node(n: Partial<StackNode> & Pick<StackNode, "id" | "title" | "kind">): StackNode {
  return { groups: [], links: [], open: { type: "note", navId: n.id }, ...n };
}

const stack: LineageStackModel = {
  rootId: "src",
  initialPath: ["src", "c3"],
  nodes: {
    src: node({
      id: "src",
      title: "試し焼き.docx",
      kind: "asset",
      groups: [
        {
          key: "claims",
          label: "知見",
          children: ["c1", "c3"],
          hidden: [{ id: "c9", title: "省いた知見", kind: "knowledge" }],
        },
      ],
    }),
    c1: node({ id: "c1", title: "加水 70% では気泡が大きい", kind: "knowledge" }),
    c3: node({
      id: "c3",
      title: "粉が細かいほど吸水が増える",
      kind: "knowledge",
      isCurrent: true,
      groups: [{ key: "notes", label: "ノート", children: ["n1"] }],
    }),
    n1: node({ id: "n1", title: "吸水の比べ", kind: "text" }),
  },
};

const renderView = (props: Partial<Parameters<typeof LineageFlowView>[0]> = {}) =>
  render(
    <LocaleProvider>
      <LineageFlowView stack={stack} getLevelFlow={() => ({ kind: "none" })} {...props} />
    </LocaleProvider>,
  );

describe("LineageFlowView（系譜の 1 本線）", () => {
  it("元・いま見ている・ここから作ったもの の順に並ぶ", () => {
    const { container } = renderView();
    const text = container.textContent ?? "";
    const iFrom = text.indexOf("試し焼き.docx");
    const iHere = text.indexOf("粉が細かいほど吸水が増える");
    const iDerived = text.indexOf("吸水の比べ");
    expect(iFrom).toBeGreaterThanOrEqual(0);
    expect(iFrom).toBeLessThan(iHere);
    expect(iHere).toBeLessThan(iDerived);
  });

  it("同じ元から作ったほかのものは畳み、件数だけ出す（省いた分も数える）", () => {
    const { getByText, queryByText } = renderView();
    expect(queryByText("加水 70% では気泡が大きい")).toBeNull();
    fireEvent.click(getByText(/2 more|ほかに 2 件/));
    expect(getByText("加水 70% では気泡が大きい")).toBeTruthy();
    expect(getByText("省いた知見")).toBeTruthy();
  });

  it("ここから作ったものを押すと、それが注目になり、元を押すと戻る", () => {
    const { getByText, container } = renderView();
    fireEvent.click(getByText("吸水の比べ"));
    // 注目の枠（太線）に新しいノートが入る
    const focusCard = container.querySelector(".border-2");
    expect(focusCard?.textContent).toContain("吸水の比べ");
    // 現在のノートは元の行に下がる
    fireEvent.click(getByText("粉が細かいほど吸水が増える"));
    expect(container.querySelector(".border-2")?.textContent).toContain("粉が細かいほど吸水が増える");
  });

  it("stack に無い（上限で省いた）ノートは経路として作らせる", () => {
    const onFocusPath = vi.fn();
    const { getByText } = renderView({ onFocusPath });
    fireEvent.click(getByText(/2 more|ほかに 2 件/));
    fireEvent.click(getByText("省いた知見"));
    expect(onFocusPath).toHaveBeenCalledWith(["src", "c9"]);
  });

  it("線のある図を持つ段だけ「図を見る」を出し、押すと図が開く", () => {
    const graph = {
      steps: [
        { id: "a", name: "a", params: [] },
        { id: "b", name: "b", params: [] },
      ],
      entities: [],
      edges: [{ id: "e", kind: "orderOnly" as const, source: "a", target: "b" }],
    };
    const { getAllByText, queryByTestId } = renderView({
      getLevelFlow: (id) => (id === "c3" ? { kind: "note", graph, layoutScope: "s" } : { kind: "none" }),
    });
    const buttons = getAllByText(/Show diagram|図を見る/);
    expect(buttons).toHaveLength(1);
    expect(queryByTestId("step-flow")).toBeNull();
    fireEvent.click(buttons[0]);
    expect(queryByTestId("step-flow")).toBeTruthy();
  });
});
