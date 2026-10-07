// @vitest-environment jsdom
// WikiLintView の点検タブのテスト。
// AI 解析（フル点検の LLM 呼び出し）が失敗した (`report.lintError`) ときに、
// 注意枠が出て「問題は見つかりませんでした」の成功文言が出ないことを確認する
// （サーバーは lintError を返していたのにクライアントが読んでおらず、失敗が
// 「問題なし」に見えてしまっていた不具合の是正）。

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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
