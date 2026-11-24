// @vitest-environment jsdom
// 共有ライブラリ側の「計画の行」（記録のメタ）と「この計画の行の記録」（計画の逆引き）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { SharedEntry } from "../../lib/storage/shared";
import { LocaleProvider } from "../../i18n";
import { PlanRecordsSection, PlanRowMeta } from "./shared-entry-parts";

const PLAN_ID = "plan-1";

function entry(id: string, extra: Record<string, unknown>, over: Partial<SharedEntry> = {}): SharedEntry {
  return {
    id,
    type: "note",
    author: { name: "佐藤 花", email: "sato@example.com" },
    created_at: "2026-11-20T00:00:00Z",
    updated_at: "2026-11-20T00:00:00Z",
    hash: `sha256:${id}`,
    prov: { derived_from: [] },
    extra,
    ...over,
  } as SharedEntry;
}

const planRow = { planIds: [PLAN_ID], tableBlockId: "tbl-1", rowId: "row_a", rowName: "こね" };

afterEach(cleanup);

describe("PlanRowMeta", () => {
  it("計画が一覧にあれば「計画の題 › 行の名前」を出し、押すと計画を開く", () => {
    const onOpen = vi.fn();
    render(
      <LocaleProvider>
        <PlanRowMeta
          entry={entry("rec-1", { title: "こね", planRow })}
          entryTitleById={(id) => (id === PLAN_ID ? "食パンの計画" : null)}
          onOpenEntry={onOpen}
        />
      </LocaleProvider>,
    );
    const button = screen.getByTestId("shared-entry-plan-row");
    expect(button.textContent).toBe("食パンの計画 › こね");
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledWith(PLAN_ID);
  });

  it("計画が一覧に無ければ、行の名前だけを出す（押せない）", () => {
    render(
      <LocaleProvider>
        <PlanRowMeta entry={entry("rec-1", { title: "こね", planRow })} entryTitleById={() => null} />
      </LocaleProvider>,
    );
    const value = screen.getByTestId("shared-entry-plan-row");
    expect(value.tagName).toBe("SPAN");
    expect(value.textContent).toBe("こね");
  });

  it("対応の無いエントリ・形の合わない対応では何も出さない", () => {
    const { container } = render(
      <LocaleProvider>
        <PlanRowMeta entry={entry("n1", { title: "ただのノート" })} />
        <PlanRowMeta entry={entry("n2", { title: "x", planRow: { planIds: "oops" } })} />
        <PlanRowMeta entry={entry("n3", { title: "x", planRow: "<img src=x onerror=alert(1)>" })} />
      </LocaleProvider>,
    );
    expect(container.textContent).toBe("");
  });

  it("行の名前は文字として出す（HTML として解釈しない）", () => {
    render(
      <LocaleProvider>
        <PlanRowMeta
          entry={entry("rec-1", { title: "x", planRow: { ...planRow, rowName: "<b>太字</b>" } })}
          entryTitleById={() => null}
        />
      </LocaleProvider>,
    );
    const value = screen.getByTestId("shared-entry-plan-row");
    expect(value.textContent).toBe("<b>太字</b>");
    expect(value.querySelector("b")).toBeNull();
  });
});

describe("PlanRecordsSection", () => {
  it("この計画を指している記録を、行の名前・人・日付つきで並べる", () => {
    const onOpen = vi.fn();
    const entries = [
      entry(PLAN_ID, { title: "食パンの計画" }),
      entry("rec-1", { title: "こね", planRow }),
      entry("rec-2", { title: "焼成", planRow: { ...planRow, rowId: "row_c", rowName: "焼成" } }, {
        author: { name: "田中 蓮", email: "tanaka@example.com" },
      }),
      entry("other", { title: "別の計画の記録", planRow: { ...planRow, planIds: ["plan-2"] } }),
    ];
    render(
      <LocaleProvider>
        <PlanRecordsSection planId={PLAN_ID} entries={entries} onOpenEntry={onOpen} />
      </LocaleProvider>,
    );
    const section = screen.getByTestId("shared-entry-plan-records");
    const buttons = within(section).getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(section.textContent).toContain("こね");
    expect(section.textContent).toContain("佐藤 花");
    expect(section.textContent).toContain("田中 蓮");
    expect(section.textContent).not.toContain("別の計画の記録");
    fireEvent.click(buttons[0]);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("記録が無ければ何も出さない", () => {
    const { container } = render(
      <LocaleProvider>
        <PlanRecordsSection planId={PLAN_ID} entries={[entry(PLAN_ID, { title: "食パンの計画" })]} />
      </LocaleProvider>,
    );
    expect(container.textContent).toBe("");
  });
});
