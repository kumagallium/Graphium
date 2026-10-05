// @vitest-environment jsdom
// WikiLogView の「保守の操作」の節（上部）のテスト

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocaleProvider, syncLocale, t } from "../../i18n";
import type { MaintenanceListBinding } from "../knowledge-maintenance/MaintenanceRunList";
import { makeOp, makeRun } from "../knowledge-maintenance/test-helpers";
import { WikiLogView } from "./WikiLogView";
import { wikiLog } from "./wiki-log";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  syncLocale("ja");
  vi.spyOn(wikiLog, "getRecent").mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  syncLocale("en");
});

const op = makeOp({ id: "a", subject: { wikiId: "w1", title: "こね時間と生地温度" } });

function binding(over: Partial<MaintenanceListBinding> = {}): MaintenanceListBinding {
  return {
    runs: [makeRun("r1", [op])],
    states: new Map(),
    blockersOf: () => [],
    onUndo: vi.fn(),
    undoingKey: null,
    loading: false,
    hasMore: false,
    unreadableCount: 0,
    onLoadMore: vi.fn(),
    ensureLoaded: vi.fn(),
    ...over,
  };
}

function renderView(maintenance?: MaintenanceListBinding, onOpenWiki = vi.fn()) {
  render(
    <LocaleProvider>
      <WikiLogView onBack={() => {}} onOpenWiki={onOpenWiki} maintenance={maintenance} />
    </LocaleProvider>,
  );
  return { onOpenWiki };
}

describe("WikiLogView の保守の操作の節", () => {
  it("マウント時に ensureLoaded を呼び、見出し・説明・操作を出す", async () => {
    const b = binding();
    renderView(b);
    await waitFor(() => expect(screen.getByText(t("maintenance.section.title"))).toBeTruthy());
    expect(b.ensureLoaded).toHaveBeenCalledTimes(1);
    expect(screen.getByText(t("maintenance.section.hint"))).toBeTruthy();
    expect(screen.getByRole("button", { name: /^取り消す.*こね時間と生地温度/ })).toBeTruthy();
  });

  it("「取り消す」で onUndo、タイトルで onOpenWiki が呼ばれる", async () => {
    const b = binding();
    const { onOpenWiki } = renderView(b);
    await waitFor(() => screen.getByText(t("maintenance.section.title")));
    fireEvent.click(screen.getByRole("button", { name: /^取り消す.*こね時間と生地温度/ }));
    expect(b.onUndo).toHaveBeenCalledWith({ runId: "r1", operationId: "a" });
    fireEvent.click(screen.getByRole("button", { name: "こね時間と生地温度" }));
    expect(onOpenWiki).toHaveBeenCalledWith("w1");
  });

  it("操作が 1 件も無く、読み込みも終わっているときは節ごと出さない", async () => {
    const b = binding({ runs: [] });
    renderView(b);
    await waitFor(() => expect(b.ensureLoaded).toHaveBeenCalled());
    expect(screen.queryByText(t("maintenance.section.title"))).toBeNull();
  });

  it("読み込み中は節を出す（読み込み中の表示）", async () => {
    renderView(binding({ runs: [], loading: true }));
    await waitFor(() => expect(screen.getByText(t("maintenance.section.title"))).toBeTruthy());
    expect(screen.getByText(t("maintenance.list.loading"))).toBeTruthy();
  });

  it("maintenance を渡さなければ節は出ない", async () => {
    renderView(undefined);
    await waitFor(() => expect(wikiLog.getRecent).toHaveBeenCalled());
    expect(screen.queryByText(t("maintenance.section.title"))).toBeNull();
  });

  it("ログの種別 restore を出せる（アイコン・色の対応がある）", async () => {
    vi.mocked(wikiLog.getRecent).mockResolvedValue([
      {
        id: "e1",
        timestamp: new Date().toISOString(),
        type: "restore",
        wikiIds: ["w1"],
        summary: "Restored \"x\" to an earlier version",
      },
    ]);
    renderView(undefined);
    await waitFor(() => expect(screen.getByText("restore")).toBeTruthy());
  });
});
