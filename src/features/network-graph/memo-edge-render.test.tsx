// @vitest-environment jsdom
// 線のメモの描画まわりのテスト（ReactFlow を差し替えて、線の組み立てとクリックの流れを確かめる）。
//
// jsdom では React Flow が線を描かない（ノードの実測が無い）ので、ReactFlow 本体は props を
// 取り出すだけのダブルに差し替える。確かめること:
// - MemoEdge: 印の表示・aria-label・案内文（書ける / 読むだけ）、押すと印の矩形で onOpenMemo が呼ばれる
// - StepFlowView の onEdgeClick: edgeMemos を渡さない画面は従来どおり（メモの項目も、メモのみのメニューも出ない）、
//   渡した画面は「メモを書く / メモ（n）」が出て、押すと onOpen が呼ばれる
// 文言は LocaleProvider の既定（jsdom → en）で照合する。

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { EdgeProps } from "@xyflow/react";

const rf = vi.hoisted(() => ({
  props: null as null | {
    edges?: Array<{ id: string; type?: string; source: string; target: string; data?: Record<string, unknown> }>;
    onEdgeClick?: (e: unknown, edge: unknown) => void;
  },
}));

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    // 線と土台は描かない。props だけ取り出す
    ReactFlow: (props: NonNullable<typeof rf.props>) => {
      rf.props = props;
      return null;
    },
    BezierEdge: () => null,
    EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

import { LocaleProvider } from "../../i18n";
import { StepFlowView } from "./step-flow-view";
import { MemoEdge } from "./memo-edge";
import type { FlowGraphData } from "./activity-graph-adapter";
import type { EdgeMemos } from "./edge-memo";
import type { MemoSourceEdge } from "../mobile-capture";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoopObserver;
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= NoopObserver;
if (!window.matchMedia) {
  (window as unknown as { matchMedia: unknown }).matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
}

afterEach(() => {
  cleanup();
  rf.props = null;
});

// ── MemoEdge ──

function edgeProps(data: Record<string, unknown>): EdgeProps {
  return {
    id: "e1",
    source: "a",
    target: "b",
    sourceX: 0,
    sourceY: 0,
    targetX: 100,
    targetY: 100,
    sourcePosition: "bottom",
    targetPosition: "top",
    data,
  } as unknown as EdgeProps;
}

describe("MemoEdge", () => {
  it("件数があると印（aria-label に件数）が出て、書ける画面の案内文になる", () => {
    render(
      <LocaleProvider>
        <MemoEdge {...edgeProps({ memoCount: 3, canWrite: true, onOpenMemo: () => {} })} />
      </LocaleProvider>,
    );
    const chip = screen.getByRole("button", { name: /3/ });
    expect(chip.getAttribute("data-tooltip-usage")).toBe("Read the memos on this line, or write a new one right here");
  });

  it("読むだけの画面では、案内文が「読める」だけになる", () => {
    render(
      <LocaleProvider>
        <MemoEdge {...edgeProps({ memoCount: 1, canWrite: false, onOpenMemo: () => {} })} />
      </LocaleProvider>,
    );
    const chip = screen.getByRole("button");
    expect(chip.getAttribute("data-tooltip-usage")).toBe("Read the memos on this line");
  });

  it("印を押すと、印の矩形を起点に onOpenMemo が呼ばれる", () => {
    const onOpenMemo = vi.fn();
    render(
      <LocaleProvider>
        <MemoEdge {...edgeProps({ memoCount: 2, canWrite: true, onOpenMemo })} />
      </LocaleProvider>,
    );
    const chip = screen.getByRole("button");
    chip.getBoundingClientRect = () =>
      ({ top: 10, bottom: 30, left: 40, right: 80, width: 40, height: 20, x: 40, y: 10, toJSON() {} }) as DOMRect;
    fireEvent.click(chip);
    expect(onOpenMemo).toHaveBeenCalledWith({ top: 10, bottom: 30, left: 40, right: 80 });
  });

  it("件数が 0 なら印を描かない", () => {
    const { container } = render(
      <LocaleProvider>
        <MemoEdge {...edgeProps({ memoCount: 0, canWrite: true, onOpenMemo: () => {} })} />
      </LocaleProvider>,
    );
    expect(container.querySelector("button")).toBeNull();
  });
});

// ── StepFlowView の onEdgeClick ──

const graph: FlowGraphData = {
  steps: [
    { id: "a", name: "混合", params: [] },
    { id: "b", name: "焼成", params: [] },
  ],
  entities: [],
  edges: [{ id: "order-a->b", kind: "orderOnly", source: "a", target: "b", deletable: true }],
};
const TARGET: MemoSourceEdge = { graph: "steps", from: "a", to: "b", fromLabel: "混合", toLabel: "焼成" };

function mount(props: Partial<React.ComponentProps<typeof StepFlowView>>) {
  return render(
    <LocaleProvider>
      <div style={{ width: 600, height: 400 }}>
        <StepFlowView graph={graph} variant="preview" {...props} />
      </div>
    </LocaleProvider>,
  );
}

async function clickEdge() {
  await waitFor(() => expect(rf.props?.edges?.length ?? 0).toBeGreaterThan(0));
  const edge = rf.props!.edges![0];
  act(() => rf.props!.onEdgeClick!({ clientX: 50, clientY: 60 }, edge));
  return edge;
}

describe("StepFlowView の onEdgeClick と edgeMemos", () => {
  // jsdom の矩形は全部 0 で、メニューを端から押し戻す計算（useLayoutEffect）が収束しない。
  // 実ブラウザ相当に、メニュー（z-index 30 の絶対配置）は 100×30 の小箱、ほかは 600×400 の箱として返す
  const realRect = Element.prototype.getBoundingClientRect;
  const box = (l: number, t: number, r: number, b: number) =>
    ({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t, x: l, y: t, toJSON() {} }) as DOMRect;
  beforeEach(() => {
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const st = (this as HTMLElement).style;
      return st?.position === "absolute" && st.zIndex === "30" ? box(100, 100, 200, 130) : box(0, 0, 600, 400);
    };
  });
  afterEach(() => {
    Element.prototype.getBoundingClientRect = realRect;
  });

  it("edgeMemos を渡さない画面: 線は標準の種類のまま、削除できない線はメニューを開かない", async () => {
    mount({});
    const edge = await clickEdge();
    expect(edge.type).toBeUndefined();
    expect(edge.data?.memoTarget).toBeUndefined();
    expect(document.querySelector('[data-test="edgeMenuMemo"]')).toBeNull();
    // 削除の手段が無い順序線は、メニュー自体を出さない（従来どおり）
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("edgeMemos を渡さない画面: 削除できる線のメニューにメモの項目は出ない", async () => {
    mount({ onRemoveOrderEdge: () => {} });
    await clickEdge();
    expect(screen.getByRole("button", { name: /./ })).toBeTruthy();
    expect(document.querySelector('[data-test="edgeMenuMemo"]')).toBeNull();
  });

  it("edgeMemos を渡した画面（0 件・書ける）: メモだけのメニューが開き、押すと onOpen が付け先と位置で呼ばれる", async () => {
    const onOpen = vi.fn();
    const edgeMemos: EdgeMemos = { target: () => TARGET, count: () => 0, canWrite: true, onOpen };
    mount({ edgeMemos });
    const edge = await clickEdge();
    // 0 件なので標準の種類のまま（印は付かない）
    expect(edge.type).toBeUndefined();
    expect(edge.data?.memoTarget).toEqual(TARGET);
    const item = document.querySelector('[data-test="edgeMenuMemo"]') as HTMLElement;
    expect(item.textContent).toContain("Write a memo");
    fireEvent.click(item);
    expect(onOpen).toHaveBeenCalledWith(TARGET, { top: 60, bottom: 60, left: 50, right: 50 });
    // 押したらメニューは閉じる
    expect(document.querySelector('[data-test="edgeMenuMemo"]')).toBeNull();
  });

  it("edgeMemos を渡した画面（1 件以上）: 線は印つきの種類になり、メニューに件数が出る", async () => {
    const edgeMemos: EdgeMemos = { target: () => TARGET, count: () => 2, canWrite: false, onOpen: () => {} };
    mount({ edgeMemos });
    const edge = await clickEdge();
    expect(edge.type).toBe("memo");
    expect(edge.data?.memoCount).toBe(2);
    expect(edge.data?.canWrite).toBe(false);
    expect(typeof edge.data?.onOpenMemo).toBe("function");
    const item = document.querySelector('[data-test="edgeMenuMemo"]') as HTMLElement;
    expect(item.textContent).toContain("2");
  });

  it("読むだけの画面で 0 件の線: メモの項目もメニューも出ない", async () => {
    const edgeMemos: EdgeMemos = { target: () => TARGET, count: () => 0, canWrite: false, onOpen: () => {} };
    mount({ edgeMemos });
    await clickEdge();
    expect(document.querySelector('[data-test="edgeMenuMemo"]')).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("付け先の無い線（target が null）: メモの項目は出ない", async () => {
    const edgeMemos: EdgeMemos = { target: () => null, count: () => 0, canWrite: true, onOpen: () => {} };
    mount({ edgeMemos });
    const edge = await clickEdge();
    expect(edge.data?.memoTarget).toBeUndefined();
    expect(document.querySelector('[data-test="edgeMenuMemo"]')).toBeNull();
  });
});
