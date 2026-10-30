// @vitest-environment jsdom
// StepFlowView の線のメモ（edgeMemos）まわりのテスト。
//
// 対象の不変条件:
// - edgeMemos を渡さない画面（系譜・プロセス一覧・共有表示など）は、メモの印が出ずに立ち上がる
//   （線そのものが従来のまま＝同じ参照で返ることは edge-memo.test.ts の withEdgeMemo で確かめる）
// - 印の位置: 線の中央に文字（線の名前など）があるときだけ下へずらす
// jsdom では React Flow が線を描かない（ノードの実測が無い）ので、StepFlowView を載せて
// 「落ちずに立ち上がること」と、純関数の不変条件を確かめる。線の描画そのものは Storybook で見る。

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { StepFlowView } from "./step-flow-view";
import { MEMO_EDGE_CHIP_GAP, estimateLabelWidth, memoChipOffsetX } from "./memo-edge";
import type { FlowGraphData } from "./activity-graph-adapter";
import type { EdgeMemos } from "./edge-memo";

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

afterEach(cleanup);

const graph: FlowGraphData = {
  steps: [
    { id: "a", name: "混合", params: [] },
    { id: "b", name: "焼成", params: [] },
  ],
  entities: [],
  edges: [{ id: "order-a->b", kind: "orderOnly", source: "a", target: "b", deletable: true }],
};

describe("memoChipOffsetX", () => {
  it("線の中央に文字が無ければ null（印は線の中央）", () => {
    expect(memoChipOffsetX(undefined, 9)).toBeNull();
    expect(memoChipOffsetX("", 9)).toBeNull();
  });
  it("文字があれば、その右端に並べる（全角は大きさ 1 つ分、半角は 0.6 つ分で見積もる）", () => {
    expect(estimateLabelWidth("順序のみ", 9)).toBe(36);
    expect(estimateLabelWidth("ab", 10)).toBe(12);
    expect(memoChipOffsetX("順序のみ", 9)).toBe(36 / 2 + 2 + MEMO_EDGE_CHIP_GAP);
    // 大きさが文字列でも読む・読めなければ 10px とみなす
    expect(memoChipOffsetX("ab", "10px")).toBe(6 + 2 + MEMO_EDGE_CHIP_GAP);
    expect(memoChipOffsetX("ab", undefined)).toBe(6 + 2 + MEMO_EDGE_CHIP_GAP);
  });
});

describe("StepFlowView の edgeMemos", () => {
  it("edgeMemos を渡さなくても、渡しても、立ち上がる（メモの印は線が描かれるまで出ない）", () => {
    const { container, unmount } = render(
      <LocaleProvider>
        <div style={{ width: 600, height: 400 }}>
          <StepFlowView graph={graph} variant="preview" />
        </div>
      </LocaleProvider>,
    );
    expect(container.querySelector(".react-flow")).toBeTruthy();
    expect(container.querySelector('[data-test="memoChip"]')).toBeNull();
    unmount();

    const edgeMemos: EdgeMemos = {
      target: () => ({ graph: "steps", from: "a", to: "b" }),
      count: () => 2,
      canWrite: true,
      onOpen: () => {},
    };
    const withMemos = render(
      <LocaleProvider>
        <div style={{ width: 600, height: 400 }}>
          <StepFlowView graph={graph} variant="preview" edgeMemos={edgeMemos} />
        </div>
      </LocaleProvider>,
    );
    expect(withMemos.container.querySelector(".react-flow")).toBeTruthy();
  });
});
