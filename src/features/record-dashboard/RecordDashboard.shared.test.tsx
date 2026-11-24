// @vitest-environment jsdom
// 共有フォルダの記録は「共有の作者」に切り替えたときだけ並ぶ。
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { LocaleProvider, t } from "../../i18n";
import { RecordDashboard } from "./RecordDashboard";
import type { RecordItem } from "./types";

const NOW = "2026-11-17T22:00:00";

const ITEMS: RecordItem[] = [
  { id: "note:own", kind: "note", at: "2026-11-17T10:00:00", origin: "written", who: { type: "self" }, title: "自分のノート" },
  {
    id: "shared:rec",
    kind: "note",
    at: "2026-11-17T14:20:00",
    origin: "shared",
    who: { type: "other", name: "佐藤 花" },
    title: "一次発酵の記録",
    planRow: { planTitle: "食パンの計画", rowName: "一次発酵" },
    checks: { checked: 3, total: 5 },
  },
  { id: "shared:free", kind: "note", at: "2026-11-17T09:00:00", origin: "shared", who: { type: "other", name: "田中 蓮" }, title: "予熱の目安" },
];

function renderDashboard(onOpen = vi.fn()) {
  render(
    <LocaleProvider>
      <RecordDashboard items={ITEMS} now={NOW} layout="find" onOpen={onOpen} />
    </LocaleProvider>,
  );
  return onOpen;
}

const rowIds = () => [...document.querySelectorAll("[data-record-id]")].map((el) => el.getAttribute("data-record-id"));

beforeAll(() => {
  // jsdom には無い。カレンダーで日を選んだときにだけ使う
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
});

describe("ホームに並ぶ共有フォルダの記録", () => {
  it("「すべて」には出ず、「共有の作者」に切り替えると並ぶ", () => {
    renderDashboard();
    expect(rowIds()).toEqual(["note:own"]);
    fireEvent.click(screen.getByRole("button", { name: t("records.whoFilter.other") }));
    expect(rowIds()).toEqual(["shared:rec", "shared:free"]);
  });

  it("計画の行の記録には、計画の題 › 行の名前と、共有した時点の件数が付く", () => {
    renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: t("records.whoFilter.other") }));
    const row = document.querySelector('[data-record-id="shared:rec"]') as HTMLElement;
    expect(within(row).getByText("食パンの計画")).toBeTruthy();
    expect(within(row).getByText("一次発酵")).toBeTruthy();
    expect(within(row).getByRole("img", { name: t("planRecords.checksHint", { checked: "3", total: "5" }) }).textContent).toBe("3/5");
    const free = document.querySelector('[data-record-id="shared:free"]') as HTMLElement;
    expect(free.querySelector(".rd-planrow")).toBeNull();
  });

  it("行を押すと、その記録で onOpen が呼ばれる", () => {
    const onOpen = renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: t("records.whoFilter.other") }));
    fireEvent.click(document.querySelector('[data-record-id="shared:rec"]') as HTMLElement);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "shared:rec" }));
  });

  it("「共有の作者」に切り替えると、フォルダの絞り込みは外れる（共有の記録は自分のフォルダに入っていない）", () => {
    render(
      <LocaleProvider>
        <RecordDashboard
          items={[{ ...ITEMS[0], folders: ["食パン"] }, { ...ITEMS[0], id: "note:other-folder", folders: ["カレー"] }, ...ITEMS.slice(1)]}
          now={NOW}
          layout="find"
        />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("records.allFolders")) }));
    fireEvent.click(screen.getByRole("option", { name: /カレー/ }));
    expect(rowIds()).toEqual(["note:other-folder"]);
    fireEvent.click(screen.getByRole("button", { name: t("records.whoFilter.other") }));
    expect(rowIds()).toEqual(["shared:rec", "shared:free"]);
  });

  it("作者の名前で探すと、その人の記録だけが見つかった記録に並ぶ", () => {
    renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: t("records.whoFilter.other") }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "佐藤" } });
    const hits = document.querySelectorAll(".rd-hits > li");
    expect(hits).toHaveLength(1);
    expect(hits[0].textContent).toContain("一次発酵の記録");
    // 当たらなかった行は消えずに薄く残る
    expect(document.querySelector('[data-record-id="shared:free"]')?.getAttribute("data-dim")).toBe("true");
    expect(document.querySelector('[data-record-id="shared:rec"]')?.getAttribute("data-dim")).toBeNull();
  });
});
