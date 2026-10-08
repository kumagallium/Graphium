// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LocaleProvider, syncLocale, t } from "../../i18n";
import { MaintenanceOperationRow } from "./MaintenanceOperationRow";
import { makeOp } from "./test-helpers";
import type { MaintenanceOperationState } from "./types";

const op = makeOp({
  id: "op1",
  subject: { wikiId: "w1", title: "こね時間と生地温度" },
  related: [{ wikiId: "w2", title: "こねすぎの見分け方", role: "absorbed" }],
});

beforeEach(() => syncLocale("ja"));
afterEach(() => {
  cleanup();
  syncLocale("en");
});

function setup(props: Partial<React.ComponentProps<typeof MaintenanceOperationRow>> = {}) {
  return render(
    <LocaleProvider>
      <MaintenanceOperationRow operation={op} state="applied" onUndo={() => {}} {...props} />
    </LocaleProvider>,
  );
}

const undoButton = () => screen.queryByRole("button", { name: /^取り消す/ });

describe("MaintenanceOperationRow", () => {
  it("文にタイトルと件数が入り、aria-label が付く", () => {
    setup();
    expect(screen.getByText(/こね時間と生地温度/).textContent).toContain("1 件のトピックを統合しました");
    expect(undoButton()?.getAttribute("aria-label")).toContain("こね時間と生地温度");
  });

  it.each<[MaintenanceOperationState, boolean]>([
    ["applied", true],
    ["undo_partial", true],
    ["interrupted", true],
    ["undone", false],
    ["running", false],
  ])("状態 %s のボタン有無は %s", (state, has) => {
    setup({ state });
    expect(Boolean(screen.queryByRole("button", { name: /取り消す/ }))).toBe(has);
  });

  it("状態は文字で伝える（色だけにしない）", () => {
    setup({ state: "interrupted" });
    expect(screen.getByText(t("maintenance.state.interrupted"))).toBeTruthy();
  });

  it("一部だけ取り消し済みは「もう一度」のボタン", () => {
    setup({ state: "undo_partial" });
    expect(screen.getByText(t("maintenance.row.undoRetry"))).toBeTruthy();
  });

  it("外の AI（MCP）から頼まれた操作には経路の印が付き、画面からの操作には付かない", () => {
    setup({ actorLabel: "MCP (claude-desktop)" });
    const chip = screen.getByText("MCP (claude-desktop)");
    expect(chip.getAttribute("data-tooltip")).toBe(t("maintenance.row.viaMcpHint"));
    cleanup();
    setup();
    expect(screen.queryByText(/^MCP/)).toBeNull();
  });

  it("押すと onUndo が呼ばれる", () => {
    const onUndo = vi.fn();
    setup({ onUndo });
    fireEvent.click(undoButton()!);
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("妨げる操作があるとボタンは押せず、理由を出す", () => {
    const onUndo = vi.fn();
    setup({ onUndo, blockedByName: "一次発酵の見極め" });
    const b = undoButton() as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    fireEvent.click(b);
    expect(onUndo).not.toHaveBeenCalled();
    expect(screen.getByText("先に取り消してください: 一次発酵の見極め")).toBeTruthy();
  });

  it("blocked のボタンの aria-describedby が理由の要素につながる", () => {
    setup({ blockedByName: "一次発酵の見極め" });
    const id = undoButton()!.getAttribute("aria-describedby")!;
    expect(document.getElementById(id)?.textContent).toContain("一次発酵の見極め");
  });

  it("途中で止まった操作のヒントは読み上げにも届く", () => {
    setup({ state: "interrupted" });
    const id = undoButton()!.getAttribute("aria-describedby")!;
    expect(document.getElementById(id)?.textContent).toBe(t("maintenance.state.interrupted.hint"));
  });

  it("もう一度取り消すのボタン名に見える文字が含まれる", () => {
    setup({ state: "undo_partial" });
    expect(screen.getByRole("button", { name: /^もう一度取り消す/ })).toBeTruthy();
  });

  it("英語でもタイトルがボタンになり、文が英語で出る", () => {
    syncLocale("en");
    const onOpenPage = vi.fn();
    setup({ onOpenPage });
    fireEvent.click(screen.getByRole("button", { name: "こね時間と生地温度" }));
    expect(onOpenPage).toHaveBeenCalledWith("w1");
    expect(screen.getByText(/Merged topics into/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Undo:/ })).toBeTruthy();
  });

  it("取り消し済みは文字のチップだけでボタンなし", () => {
    setup({ state: "undone" });
    expect(screen.getByText(t("maintenance.state.undone"))).toBeTruthy();
  });

  it("実行中（undoing）は押せない", () => {
    setup({ undoing: true });
    expect((screen.getByRole("button", { name: /取り消し中/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("タイトルを押すとそのページを開く", () => {
    const onOpenPage = vi.fn();
    setup({ onOpenPage });
    fireEvent.click(document.querySelector(`[data-tooltip="${t("maintenance.row.openPage")}"]`)!);
    expect(onOpenPage).toHaveBeenCalledWith("w1");
  });

  it("取り消しの操作（kind: undo）も同じ部品で出て、取り消せる", () => {
    const undoOp = makeOp({
      id: "u1",
      kind: "undo",
      subject: { wikiId: "w1", title: "一次発酵の見極め" },
      undoOf: { runId: "r", operationId: "op1" },
    });
    setup({ operation: undoOp });
    expect(screen.getByText(/の操作を取り消しました/)).toBeTruthy();
    expect(undoButton()).toBeTruthy();
  });
});
