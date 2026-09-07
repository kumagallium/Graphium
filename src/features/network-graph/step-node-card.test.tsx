// @vitest-environment jsdom
// StepNodeCard の段階（stage）表示ロジックのテスト。
//
// 対象の不変条件（docs/internal/stage-rows-contract.md「カード」節）:
// - stageCount ≥ 2 のとき、折りたたみ時の件数表示は t("prov.stageCount", { n })
// - 展開時（showParams）は段階ごとに t("prov.stageHeading", { n }) の小見出しで区切って params を並べる
// - stageCount が無い（または 1 以下の）通常 step は従来どおり件数 / params をそのまま出す

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { StepNodeCard, groupParamsByStage, type StepNodeData } from "./step-node-card";
import type { ActivityParam } from "./activity-graph-adapter";
import { LocaleProvider, syncLocale } from "../../i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

describe("groupParamsByStage", () => {
  it("隣接する同じ stage をひとまとめにする（元の並びは崩さない）", () => {
    const params: ActivityParam[] = [
      { label: "rpm: 300" }, // stage 無し（own params）
      { label: "温度: 100C", stage: 1 },
      { label: "時間: 1h", stage: 1 },
      { label: "温度: 200C", stage: 2 },
    ];
    expect(groupParamsByStage(params)).toEqual([
      { stage: undefined, items: [{ label: "rpm: 300" }] },
      { stage: 1, items: [{ label: "温度: 100C", stage: 1 }, { label: "時間: 1h", stage: 1 }] },
      { stage: 2, items: [{ label: "温度: 200C", stage: 2 }] },
    ]);
  });

  it("stage が無い params はまとめて 1 グループになる", () => {
    const params: ActivityParam[] = [{ label: "a: 1" }, { label: "b: 2" }];
    expect(groupParamsByStage(params)).toEqual([{ stage: undefined, items: params }]);
  });

  it("空配列では空配列を返す", () => {
    expect(groupParamsByStage([])).toEqual([]);
  });
});

const baseActivity = (overrides: Partial<StepNodeData["activity"]> = {}): StepNodeData["activity"] => ({
  id: "step1",
  name: "撹拌",
  params: [],
  ...overrides,
});

// NodeProps<StepFlowNode> は React Flow 内部用の props（dragging/zIndex 等）を
// 多数要求するが、StepNodeCard が実際に使うのは id/data/selected だけ。
// テストでは必要な 3 つだけ渡し、残りは any キャストで埋める。
const renderCard = (data: StepNodeData) =>
  render(
    <LocaleProvider>
      <ReactFlowProvider>
        <StepNodeCard {...({ id: "step1", data, selected: false } as any)} />
      </ReactFlowProvider>
    </LocaleProvider>,
  );

describe("StepNodeCard — 段階（stage）表示", () => {
  beforeEach(() => {
    // 文言をロケール依存にせず日本語で固定して照合する
    syncLocale("ja");
  });
  afterEach(() => {
    syncLocale("en");
  });

  it("stageCount が無い通常 step は params の件数をそのまま出す（段階見出しは出ない）", () => {
    const data: StepNodeData = {
      activity: baseActivity({ params: [{ label: "rpm: 300" }, { label: "time: 1h" }] }),
    };
    const { container } = renderCard(data);
    expect(container.textContent ?? "").toContain("2");
    expect(screen.queryByText(/段階/)).toBeNull();
  });

  it("stageCount >= 2 のとき折りたたみ表示は t(prov.stageCount) の文言になる", () => {
    const data: StepNodeData = {
      activity: baseActivity({
        stageCount: 2,
        params: [
          { label: "温度: 100C", stage: 1 },
          { label: "温度: 200C", stage: 2 },
        ],
      }),
    };
    renderCard(data);
    expect(screen.getByText("段階 2")).toBeTruthy();
  });

  it("showParams かつ stageCount >= 2 のとき、段階ごとに小見出しで区切って params を並べる", () => {
    const data: StepNodeData = {
      activity: baseActivity({
        stageCount: 2,
        params: [
          { label: "温度: 100C", stage: 1 },
          { label: "時間: 1h", stage: 1 },
          { label: "温度: 200C", stage: 2 },
        ],
      }),
      showParams: true,
    };
    const { container } = renderCard(data);
    const text = container.textContent ?? "";
    // 段階見出しが 2 つとも出る
    expect(text).toContain("段階 1");
    expect(text).toContain("段階 2");
    // 各段階の params もそのまま出る
    expect(text).toContain("温度: 100C");
    expect(text).toContain("時間: 1h");
    expect(text).toContain("温度: 200C");
  });

  it("showParams かつ stageCount が無いときは段階見出しを出さず params をそのまま並べる", () => {
    const data: StepNodeData = {
      activity: baseActivity({ params: [{ label: "rpm: 300" }] }),
      showParams: true,
    };
    const { container } = renderCard(data);
    const text = container.textContent ?? "";
    expect(text).toContain("rpm: 300");
    expect(text).not.toMatch(/段階 \d/);
  });
});
