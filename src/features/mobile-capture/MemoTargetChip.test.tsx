// @vitest-environment jsdom
// MemoTargetChip の付け先の表示テスト（つながり＝線の付け先を中心に）。
//
// 対象の不変条件:
// - edge の付け先は「{渡す側} → {受け取る側}」（作成時の名前）。名前の無い端点は「名前のない手順 / 工程」
// - none は何も描かない
// 文言は LocaleProvider の既定（jsdom → en）で照合する。

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { MemoTargetChip } from "./MemoTargetChip";
import { formatMemoEdgeLabel } from "./memo-edge";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

describe("formatMemoEdgeLabel", () => {
  it("名前の無い端点は、作業手順なら「手順」、工程なら「工程」の名前のない表記", () => {
    expect(formatMemoEdgeLabel({ graph: "steps", from: "a", to: "b", fromLabel: "混合" })).toBe("混合 → Untitled step");
    expect(formatMemoEdgeLabel({ graph: "plan", from: "a", to: "b", toLabel: " 焼成 " })).toBe("Untitled operation → 焼成");
  });
});

describe("MemoTargetChip — edge", () => {
  it("線の付け先を「渡す側 → 受け取る側」で出す", () => {
    render(
      <LocaleProvider>
        <MemoTargetChip
          target={{
            kind: "edge",
            fileId: "n1",
            edge: { graph: "steps", from: "a", to: "b", fromLabel: "混合", toLabel: "焼成" },
          }}
        />
      </LocaleProvider>,
    );
    expect(screen.getByText("混合 → 焼成")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Attached to: 混合 → 焼成" })).toBeTruthy();
  });

  it("none は何も描かない", () => {
    const { container } = render(
      <LocaleProvider>
        <MemoTargetChip target={{ kind: "none" }} />
      </LocaleProvider>,
    );
    expect(container.querySelector('[data-test="memoTargetChip"]')).toBeNull();
  });
});
