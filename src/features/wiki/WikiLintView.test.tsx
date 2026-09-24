// @vitest-environment jsdom
// WikiLintView の点検タブのテスト。
// AI 解析（フル点検の LLM 呼び出し）が失敗した (`report.lintError`) ときに、
// 注意枠が出て「問題は見つかりませんでした」の成功文言が出ないことを確認する
// （サーバーは lintError を返していたのにクライアントが読んでおらず、失敗が
// 「問題なし」に見えてしまっていた不具合の是正）。

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { LocaleProvider, syncLocale } from "../../i18n";
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
