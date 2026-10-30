// @vitest-environment jsdom
// useEdgeMemos（線のメモを編集ラッパーに結ぶフック）のテスト。
//
// 対象の不変条件:
// - captureIndex / noteFileId が揃わないときは edgeMemos を返さない（StepFlowView は従来のまま）
// - target は付け先（名前つき）、count は captureIndex から引いた組の件数
// - onOpen で小窓が開き、見出しは「渡す側 → 受け取る側」、その組のメモだけを出す
// - 書く欄は onCreateMemo があるときだけ。送ると付け先（MemoSourceEdge）つきで渡る
// 文言は LocaleProvider の既定（jsdom → en）で照合する。

import { describe, it, expect, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import type { CaptureEntry, CaptureIndex, MemoSourceEdge } from "../mobile-capture";
import type { FlowGraphData } from "./activity-graph-adapter";
import { pointToRect, type EdgeMemos } from "./edge-memo";
import { useEdgeMemos, type UseEdgeMemosInput } from "./use-edge-memos";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoopObserver;

afterEach(cleanup);

const graph: FlowGraphData = {
  steps: [
    { id: "s-mix", name: "混合", params: [] },
    { id: "s-fire", name: "焼成", params: [] },
  ],
  entities: [],
  edges: [{ id: "order", kind: "orderOnly", source: "s-mix", target: "s-fire" }],
};
const EDGE: MemoSourceEdge = { graph: "steps", from: "s-mix", to: "s-fire", fromLabel: "混合", toLabel: "焼成" };
const memo = (id: string, text: string, over: Partial<CaptureEntry> = {}): CaptureEntry => ({
  id,
  text,
  createdAt: "2026-10-30T10:00:00.000Z",
  sourceNote: { fileId: "n1" },
  sourceEdge: EDGE,
  ...over,
});
const index = (captures: CaptureEntry[]): CaptureIndex => ({ version: 1, updatedAt: "2026-10-30T00:00:00Z", captures });

function Harness({ input, onReady }: { input: UseEdgeMemosInput; onReady: (m: EdgeMemos | undefined) => void }) {
  const { edgeMemos, popover } = useEdgeMemos(input);
  onReady(edgeMemos);
  return <>{popover}</>;
}

function setup(over: Partial<UseEdgeMemosInput> = {}) {
  let latest: EdgeMemos | undefined;
  const input: UseEdgeMemosInput = {
    graphKind: "steps",
    graph,
    noteFileId: "n1",
    captureIndex: index([memo("m1", "温度を確認する"), memo("m2", "別の線", { sourceEdge: { ...EDGE, from: "s-fire", to: "s-mix" } })]),
    ...over,
  };
  const utils = render(
    <LocaleProvider>
      <Harness input={input} onReady={(m) => (latest = m)} />
    </LocaleProvider>,
  );
  return { get edgeMemos() { return latest; }, ...utils };
}

describe("useEdgeMemos", () => {
  it("captureIndex / ノートの id が無いときは edgeMemos を返さない", () => {
    expect(setup({ captureIndex: null }).edgeMemos).toBeUndefined();
    cleanup();
    expect(setup({ noteFileId: null }).edgeMemos).toBeUndefined();
  });

  it("target は名前つきの付け先、count はその組のメモの件数（向きが違えば別の組）", () => {
    const h = setup();
    const order = graph.edges[0];
    expect(h.edgeMemos!.target(order)).toEqual(EDGE);
    expect(h.edgeMemos!.count(EDGE)).toBe(1);
    expect(h.edgeMemos!.count({ ...EDGE, from: "s-fire", to: "s-mix" })).toBe(1);
    expect(h.edgeMemos!.count({ ...EDGE, to: "x" })).toBe(0);
  });

  it("canWrite は onCreateMemo の有無", () => {
    expect(setup({ onCreateMemo: vi.fn() }).edgeMemos!.canWrite).toBe(true);
    cleanup();
    expect(setup().edgeMemos!.canWrite).toBe(false);
  });

  it("onOpen で小窓が開く: 見出しは「渡す側 → 受け取る側」、その組のメモだけを出す", () => {
    const h = setup({ onCreateMemo: vi.fn() });
    act(() => h.edgeMemos!.onOpen(EDGE, pointToRect(120, 80)));
    expect(screen.getByRole("dialog", { name: "混合 → 焼成" })).toBeTruthy();
    expect(screen.getByText("温度を確認する")).toBeTruthy();
    expect(screen.queryByText("別の線")).toBeNull();
  });

  it("書く欄は onCreateMemo があるときだけ。送ると付け先つきで渡る", async () => {
    const onCreateMemo = vi.fn().mockResolvedValue(undefined);
    const h = setup({ onCreateMemo });
    act(() => h.edgeMemos!.onOpen(EDGE, pointToRect(0, 0)));
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "焼成前に乾燥" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(onCreateMemo).toHaveBeenCalledWith("焼成前に乾燥", EDGE));
  });

  it("読むだけ（onCreateMemo 無し）は書く欄を出さない", () => {
    const h = setup();
    act(() => h.edgeMemos!.onOpen(EDGE, pointToRect(0, 0)));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("温度を確認する")).toBeTruthy();
  });

  it("Esc で小窓を閉じる", () => {
    const h = setup();
    act(() => h.edgeMemos!.onOpen(EDGE, pointToRect(0, 0)));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("同じ線の小窓が開いているときに onOpen（印を押す）すると閉じる。別の線なら切り替わる", () => {
    const h = setup();
    const other: MemoSourceEdge = { ...EDGE, from: "s-fire", to: "s-mix", fromLabel: "焼成", toLabel: "混合" };
    act(() => h.edgeMemos!.onOpen(EDGE, pointToRect(0, 0)));
    expect(screen.getByRole("dialog", { name: "混合 → 焼成" })).toBeTruthy();
    act(() => h.edgeMemos!.onOpen(other, pointToRect(0, 0)));
    expect(screen.getByRole("dialog", { name: "焼成 → 混合" })).toBeTruthy();
    act(() => h.edgeMemos!.onOpen(other, pointToRect(0, 0)));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("印の矩形の中を押しても(mousedown)小窓は閉じず、続く onOpen で閉じる。矩形の外を押すと閉じる", () => {
    const h = setup();
    const chip = { top: 100, bottom: 120, left: 200, right: 240 };
    act(() => h.edgeMemos!.onOpen(EDGE, chip));
    // 印の上の mousedown: 閉じない（閉じてから click で開き直す、にならない）
    fireEvent.mouseDown(document.body, { clientX: 210, clientY: 110 });
    expect(screen.getByRole("dialog")).toBeTruthy();
    act(() => h.edgeMemos!.onOpen(EDGE, chip));
    expect(screen.queryByRole("dialog")).toBeNull();
    // 外側の mousedown は閉じる
    act(() => h.edgeMemos!.onOpen(EDGE, chip));
    fireEvent.mouseDown(document.body, { clientX: 600, clientY: 500 });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("メニューから開いた点の起点（幅 0）は、その位置を押しても閉じる", () => {
    const h = setup();
    act(() => h.edgeMemos!.onOpen(EDGE, pointToRect(300, 300)));
    fireEvent.mouseDown(document.body, { clientX: 300, clientY: 300 });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
