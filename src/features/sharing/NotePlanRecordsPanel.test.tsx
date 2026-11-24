// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { SharedEntry } from "../../lib/storage/shared";
import { LocaleProvider, t } from "../../i18n";
import {
  NotePlanRecordsBadge,
  NotePlanRecordsPanel,
  planRecordFreshness,
  type PlanRecordsRow,
} from "./NotePlanRecordsPanel";

const PLAN_ID = "plan-1";
const ROWS: PlanRecordsRow[] = [
  { tableBlockId: "tbl-1", rowId: "row_a", name: "@こね" },
  { tableBlockId: "tbl-1", rowId: "row_b", name: "一次発酵" },
];

function record(id: string, email: string, rowId: string, rowName: string, over: Partial<SharedEntry> = {}): SharedEntry {
  return {
    id,
    type: "note",
    author: { name: email.split("@")[0], email },
    created_at: "2026-11-20T00:00:00Z",
    updated_at: "2026-11-20T00:00:00Z",
    hash: `sha256:${id}`,
    prov: { derived_from: [] },
    extra: { title: rowName, planRow: { planIds: [PLAN_ID], tableBlockId: "tbl-1", rowId, rowName } },
    ...over,
  } as SharedEntry;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("planRecordFreshness", () => {
  const entry = record("r1", "sato@example.com", "row_a", "こね");
  it("自分の記録には印を付けない", () => {
    expect(planRecordFreshness(entry, "sato@example.com", {})).toBeNull();
  });
  it("まだ開いていない記録は new、開いたあとに変わった記録は updated", () => {
    expect(planRecordFreshness(entry, "me@example.com", {})).toBe("new");
    expect(planRecordFreshness(entry, "me@example.com", { r1: { hash: "sha256:old", comments: 0, at: "" } })).toBe("updated");
    expect(planRecordFreshness(entry, "me@example.com", { r1: { hash: "sha256:r1", comments: 0, at: "" } })).toBeNull();
  });
});

describe("NotePlanRecordsPanel", () => {
  it("行ごとに記録を並べ、記録の無い行は「まだありません」と出す", () => {
    const onOpen = vi.fn();
    render(
      <LocaleProvider><NotePlanRecordsPanel
        planIds={[PLAN_ID]}
        rows={ROWS}
        entries={[record("r1", "sato@example.com", "row_a", "こね")]}
        seen={{}}
        selfEmail="teacher@example.com"
        onOpenEntry={onOpen}
      /></LocaleProvider>,
    );
    const rows = screen.getAllByTestId("plan-records-row");
    expect(rows).toHaveLength(2);
    // 行名は "@" を外して出す
    expect(within(rows[0]).getByText("こね")).toBeTruthy();
    expect(within(rows[0]).getByText("sato")).toBeTruthy();
    expect(within(rows[0]).getByText(t("planRecords.fresh.new"))).toBeTruthy();
    expect(within(rows[1]).getByText(t("planRecords.none"))).toBeTruthy();
    expect(screen.getByText(t("planRecords.summary", { withRecords: "1", total: "2" }))).toBeTruthy();

    fireEvent.click(within(rows[0]).getByTestId("plan-record-item"));
    expect(onOpen).toHaveBeenCalledWith("r1");
  });

  it("合う行が無い記録は、最後の節に行の名前つきで残す", () => {
    render(
      <LocaleProvider><NotePlanRecordsPanel
        planIds={[PLAN_ID]}
        rows={ROWS}
        entries={[record("r9", "tanaka@example.com", "row_zzz", "冷却")]}
        seen={{}}
      /></LocaleProvider>,
    );
    const section = screen.getByTestId("plan-records-unmatched");
    expect(within(section).getByText("冷却")).toBeTruthy();
    expect(within(section).getByText("tanaka")).toBeTruthy();
  });

  it("別の計画を指す記録・共有をやめた記録は出さない", () => {
    const other = record("r2", "sato@example.com", "row_a", "こね");
    (other.extra as any).planRow.planIds = ["another-plan"];
    render(
      <LocaleProvider><NotePlanRecordsPanel
        planIds={[PLAN_ID]}
        rows={ROWS}
        entries={[other, record("r3", "sato@example.com", "row_a", "こね", { status: "unshared" })]}
        seen={{}}
      /></LocaleProvider>,
    );
    expect(screen.queryAllByTestId("plan-record-item")).toHaveLength(0);
  });
});

describe("NotePlanRecordsPanel — 重なる行・壊れた封筒", () => {
  it("同じ名前の行（行の id が無い）が 2 つあるとき、記録は先に出た行にだけ並ぶ", () => {
    const rows: PlanRecordsRow[] = [
      { tableBlockId: "tbl-1", name: "こね" },
      { tableBlockId: "tbl-1", name: "こね" },
    ];
    const rec = record("r1", "sato@example.com", "", "こね");
    delete (rec.extra as any).planRow.rowId;
    render(
      <LocaleProvider>
        <NotePlanRecordsPanel planIds={[PLAN_ID]} rows={rows} entries={[rec]} seen={{}} />
      </LocaleProvider>,
    );
    const rendered = screen.getAllByTestId("plan-records-row");
    expect(within(rendered[0]).queryAllByTestId("plan-record-item")).toHaveLength(1);
    expect(within(rendered[1]).queryAllByTestId("plan-record-item")).toHaveLength(0);
    expect(screen.getByText(t("planRecords.summary", { withRecords: "1", total: "2" }))).toBeTruthy();
  });

  it("名前や日時が欠けた封筒が混ざっても描画できる", () => {
    const broken = record("r1", "sato@example.com", "row_a", "こね");
    delete (broken as any).updated_at;
    (broken as any).author = { name: { evil: true }, email: 3 };
    render(
      <LocaleProvider>
        <NotePlanRecordsPanel
          planIds={[PLAN_ID]}
          rows={ROWS}
          entries={[broken, record("r2", "tanaka@example.com", "row_a", "こね")]}
          seen={{}}
        />
        <NotePlanRecordsBadge planIds={[PLAN_ID]} entries={[broken]} />
      </LocaleProvider>,
    );
    expect(screen.getAllByTestId("plan-record-item")).toHaveLength(2);
    expect(screen.getByText(t("library.unknownAuthor"))).toBeTruthy();
  });
});

describe("NotePlanRecordsBadge", () => {
  it("記録が無ければ出ない。あれば件数を出す", () => {
    const { rerender } = render(<LocaleProvider><NotePlanRecordsBadge planIds={[PLAN_ID]} entries={[]} /></LocaleProvider>);
    expect(screen.queryByTestId("note-plan-records-badge")).toBeNull();
    rerender(
      <LocaleProvider>
        <NotePlanRecordsBadge
          planIds={[PLAN_ID]}
          entries={[record("r1", "sato@example.com", "row_a", "こね")]}
          selfEmail="teacher@example.com"
        />
      </LocaleProvider>,
    );
    const badge = screen.getByTestId("note-plan-records-badge");
    expect(badge.textContent).toContain(t("planRecords.countLabel", { count: "1" }));
    expect(badge.textContent).toContain(t("planRecords.newBadge", { count: "1" }));
  });
});

describe("NotePlanRecordsPanel — チェックの件数", () => {
  const withChecks = (entry: SharedEntry, checked: number, total: number): SharedEntry => ({
    ...entry,
    extra: { ...entry.extra, bodyHash: "sha256:body", checklist: { checked, total, bodyHash: "sha256:body" } },
  });

  it("件数の写しがある記録には「印の数/全体」を出し、注記を添える", () => {
    render(
      <LocaleProvider><NotePlanRecordsPanel
        planIds={[PLAN_ID]}
        rows={ROWS}
        entries={[
          withChecks(record("r1", "sato@example.com", "row_a", "こね"), 3, 5),
          record("r2", "tanaka@example.com", "row_b", "一次発酵"),
        ]}
        seen={{}}
        selfEmail="teacher@example.com"
      /></LocaleProvider>,
    );
    const items = screen.getAllByTestId("plan-record-item");
    const chip = within(items[0]).getByTestId("checklist-count");
    expect(chip.textContent).toBe("3/5");
    expect(chip.getAttribute("aria-label")).toBe(t("planRecords.checksHint", { checked: "3", total: "5" }));
    // チェックリストの無い記録には何も出さない（0/0 と出さない）
    expect(within(items[1]).queryByTestId("checklist-count")).toBeNull();
    expect(screen.getByTestId("plan-records-checks-note").textContent).toContain(t("planRecords.checksFootnote"));
  });

  it("件数の分かる記録が 1 件も無ければ、注記も出さない", () => {
    render(
      <LocaleProvider><NotePlanRecordsPanel
        planIds={[PLAN_ID]}
        rows={ROWS}
        entries={[record("r1", "sato@example.com", "row_a", "こね")]}
        seen={{}}
        selfEmail="teacher@example.com"
      /></LocaleProvider>,
    );
    expect(screen.queryByTestId("checklist-count")).toBeNull();
    expect(screen.queryByTestId("plan-records-checks-note")).toBeNull();
  });

  it("本文と合わない写し（bodyHash が違う）は出さない", () => {
    const stale = record("r1", "sato@example.com", "row_a", "こね");
    render(
      <LocaleProvider><NotePlanRecordsPanel
        planIds={[PLAN_ID]}
        rows={ROWS}
        entries={[{ ...stale, extra: { ...stale.extra, bodyHash: "sha256:new", checklist: { checked: 3, total: 5, bodyHash: "sha256:old" } } }]}
        seen={{}}
        selfEmail="teacher@example.com"
      /></LocaleProvider>,
    );
    expect(screen.queryByTestId("checklist-count")).toBeNull();
  });
});
