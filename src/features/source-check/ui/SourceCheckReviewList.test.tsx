// @vitest-environment jsdom
// SourceCheckReviewList のテスト。
//
// 対象の不変条件:
// - 0 件のときは何も描画しない（呼び出し側の「開始画面だけ」の判断を邪魔しない）
// - 各行の「開く / 確認した / アーカイブ / もう一度照合」がそれぞれ対応するハンドラを呼ぶ
// - 実行中（runningId 一致 or batchRunning）は「もう一度照合」を無効化する
// - チェックボックスで選んだ行のまとめてアーカイブが選択した id 全部を渡す

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { LocaleProvider, syncLocale, t } from "../../../i18n";
import { SourceCheckReviewList, type SourceCheckReviewListProps } from "./SourceCheckReviewList";
import type { NeedsReviewEntry } from "../needs-review";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function items(): NeedsReviewEntry[] {
  return [
    { id: "c1", title: "知見1", kind: "claim", verdict: "contradicted" },
    { id: "t1", title: "トピック1", kind: "topic", verdict: "not-in-source" },
  ];
}

function renderList(overrides: Partial<SourceCheckReviewListProps> = {}) {
  const props: SourceCheckReviewListProps = {
    items: items(),
    onOpen: vi.fn(),
    onDismiss: vi.fn(async () => {}),
    onArchive: vi.fn(async () => {}),
    onBulkArchive: vi.fn(async () => {}),
    onRecheck: vi.fn(async () => {}),
    ...overrides,
  };
  const utils = render(
    <LocaleProvider>
      <SourceCheckReviewList {...props} />
    </LocaleProvider>,
  );
  return { ...utils, props };
}

describe("SourceCheckReviewList", () => {
  beforeEach(() => {
    syncLocale("en");
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("0 件のときは何も描画しない", () => {
    const { container } = renderList({ items: [] });
    expect(container.firstChild).toBeNull();
  });

  it("件数見出しと各行のタイトル・種類ラベルを出す", () => {
    renderList();
    expect(screen.getByText(t("wikiLint.sourceCheck.review.header", { count: "2" }))).toBeTruthy();
    expect(screen.getByText("知見1")).toBeTruthy();
    expect(screen.getByText("トピック1")).toBeTruthy();
  });

  it("「開く」は onOpen(id) を呼ぶ", () => {
    const { props } = renderList();
    const openButtons = screen.getAllByText(t("wikiLint.action.open"));
    fireEvent.click(openButtons[0]);
    expect(props.onOpen).toHaveBeenCalledWith("c1");
  });

  it("「確認した」は onDismiss(id) を呼ぶ（確認ダイアログ無し）", async () => {
    const { props } = renderList();
    const buttons = screen.getAllByText(t("sourceCheck.dismiss"));
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(props.onDismiss).toHaveBeenCalledWith("c1"));
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("「アーカイブ」は確認ダイアログのあと onArchive(id) を呼ぶ", async () => {
    const { props } = renderList();
    const buttons = screen.getAllByText(t("wikiLint.action.archive"));
    fireEvent.click(buttons[0]);
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(props.onArchive).toHaveBeenCalledWith("c1"));
  });

  it("「もう一度照合」は onRecheck(id) を呼ぶ", async () => {
    const { props } = renderList();
    const buttons = screen.getAllByText(t("sourceCheck.recheck"));
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(props.onRecheck).toHaveBeenCalledWith("c1"));
  });

  it("runningId が一致する行は「もう一度照合」を無効化する", () => {
    renderList({ runningId: "c1" });
    const buttons = screen.getAllByText(t("sourceCheck.recheck")).map((el) => el.closest("button")!);
    expect(buttons[0].disabled).toBe(true);
    expect(buttons[1].disabled).toBe(false);
  });

  it("batchRunning のときは全行の「もう一度照合」を無効化する", () => {
    renderList({ batchRunning: true });
    const buttons = screen.getAllByText(t("sourceCheck.recheck")).map((el) => el.closest("button")!);
    expect(buttons[0].disabled).toBe(true);
    expect(buttons[1].disabled).toBe(true);
  });

  it("チェックボックスで選んだ行だけをまとめてアーカイブする", async () => {
    const { props } = renderList();
    const checkboxes = screen.getAllByLabelText(t("wikiLint.bulk.select"));
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    const bulkButton = screen.getByText(t("wikiLint.sourceCheck.review.bulkArchiveButton", { count: "2" }));
    fireEvent.click(bulkButton);
    await waitFor(() => expect(props.onBulkArchive).toHaveBeenCalledWith(["c1", "t1"]));
  });
});
