// @vitest-environment jsdom
// ステップパネルの「本文で付けたパラメータが表から消えない」不変条件のテスト
//
// 対象の不変条件:
// - 本文ハイライト由来の Entity に紐づいた属性は、その種類の表に列が無くても
//   薄い列として現れる（本文にラベルがあるのに表から消える、を防ぐ）
// - 手順そのものに紐づいたパラメータは［パラメータ］表の薄い列に現れる

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { FlowStepPanel, type StepPanelData, type FlowSelection, type SectionKind } from "./flow-attribute-table";
import type { TableData } from "./table-row-edit";
import { LocaleProvider, syncLocale } from "../../i18n";

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

// 段階（stage）行の UI（表パネル節）: entityGrid の行追加ボタン文言 / paramGrid の
// 「段階を追加」/ 番号セルの表示専用性を確認する
const dataWithTable = (kind: SectionKind, table: TableData): StepPanelData => ({
  stepId: "step1",
  stepName: "Ball milling",
  tables: { attribute: null, material: null, tool: null, output: null, [kind]: table },
  prose: [],
});

describe("FlowStepPanel — 段階（stage）行の UI", () => {
  beforeEach(() => {
    // ボタン文言をロケール依存にせず日本語で固定して照合する
    syncLocale("ja");
  });
  afterEach(() => {
    syncLocale("en");
  });

  it("material / tool / output はラベル名を織り込んだ行追加ボタンが出て「行を追加」は出ない", () => {
    const expected: Record<"material" | "tool" | "output", string> = {
      material: "インプットを追加",
      tool: "ツールを追加",
      output: "アウトプットを追加",
    };
    (Object.keys(expected) as (keyof typeof expected)[]).forEach((kind) => {
      const table: TableData = { blockId: `b_${kind}`, headers: ["name"], rows: [["A"]] };
      const { container, unmount } = render(
        <LocaleProvider>
          <FlowStepPanel selection={selection} data={dataWithTable(kind, table)} onAddRow={() => {}} />
        </LocaleProvider>,
      );
      const text = container.textContent ?? "";
      expect(text).toContain(expected[kind]);
      expect(text).not.toContain("行を追加");
      unmount();
    });
  });

  it("attribute は「段階を追加」ボタンが出てクリックで onAddRow(blockId, \"\") が呼ばれる。1 行のときは番号セルが出ない", () => {
    const table: TableData = { blockId: "b_attr", headers: ["rpm"], rows: [["300"]] };
    const onAddRow = vi.fn();
    const { container } = render(
      <LocaleProvider>
        <FlowStepPanel selection={selection} data={dataWithTable("attribute", table)} onAddRow={onAddRow} />
      </LocaleProvider>,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("段階を追加");
    const button = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("段階を追加"),
    );
    expect(button).toBeTruthy();
    fireEvent.click(button!);
    expect(onAddRow).toHaveBeenCalledWith("b_attr", "");
    // 1 行のときは表示専用の番号セルが出ない
    expect(screen.queryByText("1")).toBeNull();
  });

  it("attribute の 3 行 TableData で番号 1,2,3 が出る。onAddColumn / onRenameColumn は呼ばれない", () => {
    const table: TableData = {
      blockId: "b_attr3",
      headers: ["temp"],
      rows: [["20"], ["40"], ["60"]],
    };
    const onAddColumn = vi.fn();
    const onRenameColumn = vi.fn();
    render(
      <LocaleProvider>
        <FlowStepPanel
          selection={selection}
          data={dataWithTable("attribute", table)}
          onAddRow={() => {}}
          onAddColumn={onAddColumn}
          onRenameColumn={onRenameColumn}
        />
      </LocaleProvider>,
    );
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(onAddColumn).not.toHaveBeenCalled();
    expect(onRenameColumn).not.toHaveBeenCalled();
  });
});
