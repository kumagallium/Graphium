// @vitest-environment jsdom
// 更新の行は、更新した日に並ぶ。記録の数と見つかった記録には入れない（同じノートを 2 回数えない）。
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LocaleProvider, t } from "../../i18n";
import { RecordDashboard } from "./RecordDashboard";
import type { RecordItem } from "./types";

const NOW = "2026-11-17T22:00:00";

const ITEMS: RecordItem[] = [
  {
    id: "note-updated:n1",
    kind: "note",
    at: "2026-11-17T16:40:00",
    origin: "written",
    who: { type: "self" },
    title: "食パンの試作 3 回目",
    update: { createdAt: "2026-11-10T09:15:00" },
  },
  { id: "note:n2", kind: "note", at: "2026-11-17T10:00:00", origin: "written", who: { type: "self" }, title: "今日のメモ書き" },
  { id: "note:n1", kind: "note", at: "2026-11-10T09:15:00", origin: "written", who: { type: "self" }, title: "食パンの試作 3 回目" },
];

function renderDashboard(onOpen = vi.fn()) {
  render(
    <LocaleProvider>
      <RecordDashboard items={ITEMS} now={NOW} layout="find" onOpen={onOpen} />
    </LocaleProvider>,
  );
  return onOpen;
}

beforeAll(() => {
  // jsdom には無い。カレンダーで日を選んだときにだけ使う
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});

afterEach(cleanup);

describe("ホームの更新の行", () => {
  it("更新した日（今日）の欄に更新の行が並び、作成の行は作った日に残る", () => {
    renderDashboard();
    const today = document.querySelector(".rd-day") as HTMLElement;
    const ids = [...today.querySelectorAll("[data-record-id]")].map((el) => el.getAttribute("data-record-id"));
    expect(ids).toEqual(["note-updated:n1", "note:n2"]);
    const updated = today.querySelector('[data-event="updated"]') as HTMLElement;
    expect(updated.textContent).toContain(t("records.updated"));
    expect(updated.textContent).toContain(t("records.createdOn", { date: "11月10日" }).replace("11月10日", ""));
  });

  it("記録の数には更新の行を入れない", () => {
    renderDashboard();
    expect(document.querySelector(".rd-log-head .rd-total")?.textContent).toBe(t("records.count", { n: "2" }));
  });

  it("探すと、見つかった記録には作成の行だけが出る（更新の行は薄くならずに残る）", () => {
    renderDashboard();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "試作" } });
    const hits = document.querySelectorAll(".rd-hits > li");
    expect(hits).toHaveLength(1);
    expect(document.querySelector('[data-record-id="note-updated:n1"]')?.getAttribute("data-dim")).toBeNull();
  });

  it("更新の行を押すと、そのノートを開く", () => {
    const onOpen = renderDashboard();
    fireEvent.click(document.querySelector('[data-record-id="note-updated:n1"]') as HTMLElement);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "note-updated:n1", kind: "note" }));
  });
});
