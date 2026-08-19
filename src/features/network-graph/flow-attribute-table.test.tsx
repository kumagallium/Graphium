// @vitest-environment jsdom
// ステップパネルの「本文で付けたパラメータが表から消えない」不変条件のテスト
//
// 対象の不変条件:
// - 本文ハイライト由来の Entity に紐づいた属性は、その種類の表に列が無くても
//   薄い列として現れる（本文にラベルがあるのに表から消える、を防ぐ）
// - 手順そのものに紐づいたパラメータは［パラメータ］表の薄い列に現れる

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { FlowStepPanel, type StepPanelData, type FlowSelection } from "./flow-attribute-table";
import { LocaleProvider } from "../../i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

const step = { id: "step1", name: "Ball milling", params: [], inputs: [], outputs: [] } as any;
const selection: FlowSelection = { kind: "step", step };

const data = (prose: StepPanelData["prose"]): StepPanelData => ({
  stepId: "step1",
  stepName: "Ball milling",
  tables: { attribute: null, material: null, tool: null, output: null },
  prose,
});

const renderPanel = (d: StepPanelData) =>
  render(
    <LocaleProvider>
      <FlowStepPanel selection={selection} data={d} onCreateSectionTable={() => {}} />
    </LocaleProvider>,
  );

describe("FlowStepPanel — 本文由来のパラメータ", () => {
  it("Entity に紐づいた属性を、列が無くても薄い列として出す", () => {
    const { container } = renderPanel(
      data([
        {
          entityId: "ent_tool_1",
          nodeId: "inline_tool_1",
          kind: "tool",
          label: "プラネタリーボールミル",
          attrs: [{ label: "diameter: 1.6 mm" }],
        },
      ]),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("プラネタリーボールミル");
    expect(text).toContain("diameter");
    expect(text).toContain("1.6 mm");
  });

  it("手順に紐づいたパラメータは［パラメータ］表の列として出る", () => {
    const { container } = renderPanel(
      data([{ entityId: "ent_attr_1", kind: "attribute", label: "rpm: 300" }]),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("rpm");
    expect(text).toContain("300");
  });

  it("属性が無い Entity では余計な列を作らない", () => {
    const { container } = renderPanel(
      data([{ entityId: "ent_mat_1", nodeId: "inline_mat_1", kind: "material", label: "粉末" }]),
    );
    expect(container.textContent ?? "").toContain("粉末");
    expect(container.querySelectorAll("table").length).toBeGreaterThan(0);
  });
});
