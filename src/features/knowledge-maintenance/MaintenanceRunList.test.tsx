// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LocaleProvider, syncLocale, t } from "../../i18n";
import {
  MaintenanceRunList,
  runsHaveOperation,
  runsTouchPage,
  type MaintenanceRunListProps,
} from "./MaintenanceRunList";
import { operationKey } from "./run-format";
import { makeOp, makeRun } from "./test-helpers";

const opA = makeOp({ id: "a", subject: { wikiId: "w1", title: "こね時間と生地温度" } });
const opB = makeOp({ id: "b", subject: { wikiId: "w2", title: "一次発酵の見極め" } });
const opC = makeOp({ id: "c", kind: "regenerate", subject: { wikiId: "w3", title: "加水率と食感の関係" } });

const single = makeRun("r1", [opC]);
const multi = { ...makeRun("r2", [opA, opB]), trigger: "organize_topics" as const };

beforeEach(() => syncLocale("ja"));
afterEach(() => {
  cleanup();
  syncLocale("en");
});

function setup(props: Partial<MaintenanceRunListProps> = {}) {
  const onUndo = vi.fn();
  render(
    <LocaleProvider>
      <MaintenanceRunList
        runs={[multi, single]}
        states={new Map()}
        blockersOf={() => []}
        onUndo={onUndo}
        {...props}
      />
    </LocaleProvider>,
  );
  return { onUndo };
}

describe("MaintenanceRunList", () => {
  it("複数の操作がある実行だけ見出しを出す", () => {
    setup();
    expect(screen.getByText(t("maintenance.trigger.organize_topics"))).toBeTruthy();
    expect(screen.getByText(/2 件の操作/)).toBeTruthy();
    // 1 件だけの実行には見出しが無い
    expect(screen.queryByText(t("maintenance.trigger.regenerate"))).toBeNull();
  });

  it("外の AI（MCP）から頼まれた実行の操作には経路の印が付く", () => {
    const viaMcp = { ...makeRun("r3", [makeOp({ id: "m", subject: { wikiId: "w9", title: "発酵と温度" } })]), actor: { via: "mcp" as const, client: "claude-desktop" } };
    setup({ runs: [viaMcp, single] });
    expect(screen.getByText(t("maintenance.row.viaMcp", { client: "claude-desktop" }))).toBeTruthy();
    // 画面から行った実行（single）には印が無い
    expect(screen.getAllByText(/^MCP/)).toHaveLength(1);
  });

  it("押した操作の target で onUndo が呼ばれる", () => {
    const { onUndo } = setup();
    fireEvent.click(screen.getByRole("button", { name: /^取り消す.*一次発酵の見極め/ }));
    expect(onUndo).toHaveBeenCalledWith({ runId: "r2", operationId: "b" });
  });

  it("状態は states から引く（取り消し済みはボタンなし）", () => {
    setup({ states: new Map([[operationKey("r1", "c"), { state: "undone" as const }]]) });
    expect(screen.queryByRole("button", { name: /^取り消す.*加水率と食感の関係/ })).toBeNull();
    expect(screen.getByText(t("maintenance.state.undone"))).toBeTruthy();
  });

  it("妨げる操作があるとボタンは押せない", () => {
    setup({
      blockersOf: (tg) => (tg.operationId === "c" ? [{ runId: "r2", operationId: "a", op: opA }] : []),
    });
    const b = screen.getByRole("button", { name: /^取り消す.*加水率と食感の関係/ }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(screen.getByText(/先に取り消してください: .*こね時間と生地温度/)).toBeTruthy();
  });

  it("ページで絞り込む（該当しない操作・実行は出ない。1 件になれば見出しも消える）", () => {
    setup({ filterWikiId: "w1" });
    expect(screen.queryByText(/一次発酵の見極め/)).toBeNull();
    expect(screen.queryByText(/加水率/)).toBeNull();
    expect(screen.getByText(/こね時間と生地温度/)).toBeTruthy();
    expect(screen.queryByText(/2 件の操作/)).toBeNull();
  });

  it("該当なしのときは絞り込み用の空の文", () => {
    setup({ filterWikiId: "none" });
    expect(screen.getByText(t("maintenance.list.emptyForPage"))).toBeTruthy();
  });

  it("絞り込み中に続きがあるときは「読み込み済みの範囲」の空の文", () => {
    setup({ filterWikiId: "none", hasMore: true, onLoadMore: () => {} });
    expect(screen.getByText(t("maintenance.list.emptyForPageSoFar"))).toBeTruthy();
    expect(screen.queryByText(t("maintenance.list.emptyForPage"))).toBeNull();
  });

  it("空・emptyText", () => {
    setup({ runs: [], emptyText: "まだありません" });
    expect(screen.getByText("まだありません")).toBeTruthy();
  });

  it("読み込み中は空の文を出さない", () => {
    setup({ runs: [], loading: true });
    expect(screen.queryByText(t("maintenance.list.empty"))).toBeNull();
  });

  it("読めない実行の件数を出す", () => {
    setup({ unreadableCount: 2 });
    expect(screen.getByText("読めない記録が 2 件あります")).toBeTruthy();
  });

  it("さらに読み込む", () => {
    const onLoadMore = vi.fn();
    setup({ hasMore: true, onLoadMore });
    fireEvent.click(screen.getByRole("button", { name: t("maintenance.list.loadMore") }));
    expect(onLoadMore).toHaveBeenCalled();
  });

  it("hasMore が無ければボタンなし", () => {
    setup();
    expect(screen.queryByText(t("maintenance.list.loadMore"))).toBeNull();
  });

  it("取り消し実行中の操作だけ押せない", () => {
    setup({ undoingKey: operationKey("r1", "c") });
    expect((screen.getByRole("button", { name: /取り消し中/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /^取り消す.*一次発酵/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("妨げの名指しと節の判定の補助", () => {
  it("妨げが複数あるときは、いちばん新しい（末尾の）操作を名指しする", () => {
    setup({
      blockersOf: (tg) =>
        tg.operationId === "c"
          ? [
              { runId: "r2", operationId: "a", op: opA },
              { runId: "r2", operationId: "b", op: opB },
            ]
          : [],
    });
    expect(screen.getByText(/先に取り消してください: .*一次発酵の見極め/)).toBeTruthy();
  });

  it("runsTouchPage / runsHaveOperation", () => {
    expect(runsTouchPage([multi, single], "w1")).toBe(true);
    expect(runsTouchPage([multi, single], "w3")).toBe(true);
    expect(runsTouchPage([multi, single], "none")).toBe(false);
    expect(runsTouchPage([], "w1")).toBe(false);
    expect(runsHaveOperation([multi])).toBe(true);
    expect(runsHaveOperation([])).toBe(false);
    expect(runsHaveOperation([makeRun("r0", [])])).toBe(false);
  });
});
