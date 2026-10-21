// @vitest-environment jsdom
// WikiLintView の点検タブのテスト。
// AI 解析（フル点検の LLM 呼び出し）が失敗した (`report.lintError`) ときに、
// 注意枠が出て「問題は見つかりませんでした」の成功文言が出ないことを確認する
// （サーバーは lintError を返していたのにクライアントが読んでおらず、失敗が
// 「問題なし」に見えてしまっていた不具合の是正）。

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { LocaleProvider, syncLocale, t } from "../../i18n";
import type { MaintenanceListBinding } from "../knowledge-maintenance/MaintenanceRunList";
import { makeOp, makeRun } from "../knowledge-maintenance/test-helpers";
import { WikiLintView } from "./WikiLintView";
import type { LintReport } from "../../server/services/wiki-linter";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

function baseReport(overrides: Partial<LintReport> = {}): LintReport {
  return {
    issues: [],
    summary: { total: 0, contradictions: 0, orphans: 0, gaps: 0, stale: 0, redundant: 0, missingSource: 0 },
    analyzedAt: "2026-09-24T00:00:00Z",
    ...overrides,
  };
}

function renderView(report: LintReport) {
  syncLocale("ja");
  return render(
    <LocaleProvider>
      <WikiLintView
        report={report}
        loading={false}
        onRunLint={() => {}}
        onOpenWiki={() => {}}
        onBack={() => {}}
      />
    </LocaleProvider>,
  );
}

describe("WikiLintView - lintError（AI 解析失敗）の注意枠", () => {
  it("lintError があるとき、注意枠が出て『問題は見つかりませんでした』は出ない", () => {
    renderView(baseReport({ lintError: "Input length (230346) exceeds model's maximum context length (131072)." }));
    expect(screen.getByText("AI 解析ができませんでした。クイック（機械判定）の結果だけを表示しています。")).toBeTruthy();
    expect(screen.queryByText("問題は見つかりませんでした")).toBeNull();
  });

  it("lintError が無いとき（issues 0 件）は、従来どおり『問題は見つかりませんでした』が出る", () => {
    renderView(baseReport());
    expect(screen.getByText("問題は見つかりませんでした")).toBeTruthy();
  });

  it("lintError の生のエラー文は折りたたみの中にあり、既定では見えない", () => {
    const message = "Input length (230346) exceeds model's maximum context length (131072).";
    renderView(baseReport({ lintError: message }));
    expect(screen.queryByText(message)).toBeNull();
  });
});

// ── 操作の記録タブ（取り消しの一覧） ──
function binding(over: Partial<MaintenanceListBinding> = {}): MaintenanceListBinding {
  return {
    runs: [makeRun("r1", [makeOp({ id: "a", subject: { wikiId: "w1", title: "こね時間と生地温度" } })])],
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

function renderWithMaintenance(maintenance?: MaintenanceListBinding, onOpenWiki = vi.fn()) {
  syncLocale("ja");
  render(
    <LocaleProvider>
      <WikiLintView
        report={baseReport()}
        loading={false}
        onRunLint={() => {}}
        onOpenWiki={onOpenWiki}
        onBack={() => {}}
        maintenance={maintenance}
      />
    </LocaleProvider>,
  );
  return { onOpenWiki };
}

describe("WikiLintView の操作の記録タブ", () => {
  it("maintenance を渡すとタブが出る。渡さなければ出ない", () => {
    renderWithMaintenance(binding());
    expect(screen.getByRole("button", { name: t("wikiLint.tabs.operations") })).toBeTruthy();
    cleanup();
    renderWithMaintenance(undefined);
    expect(screen.queryByRole("button", { name: t("wikiLint.tabs.operations") })).toBeNull();
  });

  it("開く前は ensureLoaded を呼ばず、開くと 1 回だけ呼ぶ", () => {
    const b = binding();
    renderWithMaintenance(b);
    expect(b.ensureLoaded).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: t("wikiLint.tabs.operations") }));
    expect(b.ensureLoaded).toHaveBeenCalledTimes(1);
  });

  it("説明・一覧の行・「取り消す」が出て、押すと onUndo、タイトルで onOpenWiki が呼ばれる", () => {
    const b = binding();
    const { onOpenWiki } = renderWithMaintenance(b);
    fireEvent.click(screen.getByRole("button", { name: t("wikiLint.tabs.operations") }));
    expect(screen.getByText(t("maintenance.section.hint"))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^取り消す.*こね時間と生地温度/ }));
    expect(b.onUndo).toHaveBeenCalledWith({ runId: "r1", operationId: "a" });
    fireEvent.click(screen.getByRole("button", { name: "こね時間と生地温度" }));
    expect(onOpenWiki).toHaveBeenCalledWith("w1");
  });

  it("操作が 1 件も無いときは空の文を出す", () => {
    renderWithMaintenance(binding({ runs: [] }));
    fireEvent.click(screen.getByRole("button", { name: t("wikiLint.tabs.operations") }));
    expect(screen.getByText(t("maintenance.list.empty"))).toBeTruthy();
  });
});

// ── 一括選択（ドラッグで範囲選択） ──
// 選んだ瞬間に「N 件選択中」の行が現れると一覧が下へずれ、ドラッグ中のポインタが
// 1 行前の行を指して範囲が 1 行遅れていた。行は未選択でも確保して隠すだけにする。
describe("WikiLintView - 一括選択の行が一覧をずらさない", () => {
  const issue = (type: LintReport["issues"][number]["type"], title: string): LintReport["issues"][number] => ({
    type, severity: "warning", title, description: "d", affectedWikiIds: [`w-${title}`], suggestion: "",
  });
  const report = () => baseReport({
    issues: [issue("redundant", "A"), issue("contradiction", "B"), issue("redundant", "C")],
    summary: { total: 3, contradictions: 1, orphans: 0, gaps: 0, stale: 0, redundant: 2, missingSource: 0 },
  });
  const renderBulk = () => {
    syncLocale("ja");
    return render(
      <LocaleProvider>
        <WikiLintView report={report()} loading={false} onRunLint={() => {}} onOpenWiki={() => {}} onBack={() => {}} onBulkArchiveWikis={vi.fn()} />
      </LocaleProvider>,
    );
  };
  const bar = () => screen.getByText(/件選択中/).parentElement as HTMLElement;

  it("未選択でも選択中の行は描画され、隠れているだけ", () => {
    renderBulk();
    expect(bar().className).toContain("invisible");
    expect(bar().getAttribute("aria-hidden")).toBe("true");
  });

  it("行をドラッグすると、対象外（矛盾）を飛ばして範囲で選べ、行が見えるようになる", () => {
    renderBulk();
    const row = (title: string) => screen.getByText(title).closest("div.px-4") as HTMLElement;
    fireEvent.mouseDown(screen.getByText("A"), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(window, { clientX: 10, clientY: 40 });
    fireEvent.mouseEnter(row("B"));
    fireEvent.mouseEnter(row("C"));
    fireEvent.mouseUp(window);
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([true, true]);
    expect(bar().className).not.toContain("invisible");
  });
});

// ── 推奨どおりまとめて統合 ──
describe("WikiLintView - 推奨どおりまとめて統合", () => {
  type Issue = LintReport["issues"][number];
  const redundant = (title: string, keepId: string, absorbId: string): Issue => ({
    type: "redundant", severity: "warning", title, description: "d", affectedWikiIds: [keepId, absorbId], suggestion: "",
    recommendedAction: { type: "merge", keepId, absorbId, reason: "r" },
  });
  const stale = (title: string): Issue => ({
    type: "stale", severity: "warning", title, description: "d", affectedWikiIds: [`w-${title}`], suggestion: "",
  });
  const renderMerge = (issues: Issue[], onMergeTopics: (k: string, a: string) => Promise<void>) => {
    syncLocale("ja");
    const kinds = new Map<string, string>();
    for (const i of issues) for (const id of i.affectedWikiIds) kinds.set(id, "topic");
    return render(
      <LocaleProvider>
        <WikiLintView
          report={baseReport({ issues })}
          loading={false}
          onRunLint={() => {}}
          onOpenWiki={() => {}}
          onBack={() => {}}
          onBulkArchiveWikis={vi.fn()}
          wikiKindById={kinds}
          onMergeTopics={onMergeTopics}
        />
      </LocaleProvider>,
    );
  };
  const checkAll = () => {
    for (const box of screen.getAllByRole("checkbox")) fireEvent.click(box);
  };
  const mergeButton = () => screen.queryByRole("button", { name: /推奨どおり/ });

  it("推奨の付いた組だけを数え、一覧の順に 1 件ずつ統合して一覧から外す", async () => {
    const calls: string[] = [];
    const onMerge = vi.fn(async (k: string, a: string) => { calls.push(`${k}<-${a}`); });
    renderMerge([redundant("A", "k1", "a1"), stale("S"), redundant("B", "k2", "a2")], onMerge);
    checkAll();
    expect(mergeButton()?.textContent).toContain("推奨どおり 2 件を統合");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => { fireEvent.click(mergeButton()!); });
    confirm.mockRestore();
    expect(calls).toEqual(["k1<-a1", "k2<-a2"]);
    expect(screen.queryByText("A")).toBeNull();
    expect(screen.queryByText("B")).toBeNull();
    // 統合の対象外（古い）は選んだまま残る
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  });

  it("同じ回で吸収したページを含む組は飛ばし、失敗した組は選んだまま残す", async () => {
    const calls: string[] = [];
    const onMerge = vi.fn(async (k: string, a: string) => {
      calls.push(`${k}<-${a}`);
      if (k === "x") throw new Error("merge failed");
    });
    renderMerge([redundant("A", "k", "b"), redundant("B", "b", "c"), redundant("C", "x", "y")], onMerge);
    checkAll();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => { fireEvent.click(mergeButton()!); });
    confirm.mockRestore();
    err.mockRestore();
    // B（b<-c）は b が A で吸収済みなので呼ばない
    expect(calls).toEqual(["k<-b", "x<-y"]);
    expect(screen.queryByText("A")).toBeNull();
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([true, true]);
  });

  it("確認で取り消したら何もしない", async () => {
    const onMerge = vi.fn(async () => {});
    renderMerge([redundant("A", "k1", "a1")], onMerge);
    checkAll();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await act(async () => { fireEvent.click(mergeButton()!); });
    confirm.mockRestore();
    expect(onMerge).not.toHaveBeenCalled();
    expect(screen.getByText("A")).toBeTruthy();
  });

  it("推奨の付いた組を選んでいなければボタンは出ない", () => {
    renderMerge([stale("S"), redundant("A", "k1", "a1")], vi.fn(async () => {}));
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(mergeButton()).toBeNull();
  });
});
