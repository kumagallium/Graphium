// @vitest-environment jsdom
// SourceCheckLintSection（出典照合の点検欄, 仕様 2-b）のテスト。
// 計画 → 確認 → 実行 → 中断・完了の状態遷移を確認する。
//
// running / progress / result は useSourceCheck フックの state を props で受け取る設計
// （点検欄のローカル state に置かない、というレビュー指摘の反映）。テストでは実物の
// フックの代わりに、同じ形の state 遷移をする最小のハーネスで包んで検証する。

import { useCallback, useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { SourceCheckLintSection, type SourceCheckLintSectionProps } from "./SourceCheckLintSection";
import type { BatchRunResult, LintPlanResult } from "../../hooks/use-source-check";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

function makePlan(overrides: Partial<LintPlanResult["plan"]> = {}, targetCount = 2): LintPlanResult {
  return {
    plan: {
      groups: [{ sourceId: "note-a", statementIds: ["c1"] }],
      knownMissing: [],
      llmCalls: 1,
      statementCount: 2,
      docCount: 2,
      missingCounts: {},
      ...overrides,
    },
    statementsById: new Map(),
    targetCount,
  };
}

/** useSourceCheck の batchRunning/batchProgress/batchResult 相当を模す最小ハーネス。 */
function Harness({
  onPlan,
  onRun,
  onCancel = () => {},
}: {
  onPlan: SourceCheckLintSectionProps["onPlan"];
  onRun: (plan: LintPlanResult) => Promise<BatchRunResult>;
  onCancel?: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ index: number; total: number } | null>(null);
  const [result, setResult] = useState<BatchRunResult | null>(null);

  const run = useCallback(
    async (plan: LintPlanResult) => {
      setRunning(true);
      setProgress({ index: 0, total: plan.plan.groups.length });
      try {
        const r = await onRun(plan);
        setResult(r);
        return r;
      } finally {
        setRunning(false);
        setProgress(null);
      }
    },
    [onRun],
  );

  return (
    <SourceCheckLintSection
      onPlan={onPlan}
      onRun={run}
      onCancel={onCancel}
      running={running}
      progress={progress}
      result={result}
      onDismissResult={() => setResult(null)}
    />
  );
}

describe("SourceCheckLintSection", () => {
  it("計画を確認すると対象件数・判定回数を表示する", async () => {
    const onPlan = vi.fn(async () => makePlan());
    const onRun = vi.fn();
    render(
      <LocaleProvider>
        <Harness onPlan={onPlan} onRun={onRun as never} />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByText("Review plan"));
    await waitFor(() => expect(onPlan).toHaveBeenCalledWith("both", "unchecked"));
    expect(await screen.findByText("2 target(s) · 1 model call(s)")).toBeTruthy();
  });

  it("実行すると onRun を呼び、完了後に件数を表示する", async () => {
    const onPlan = vi.fn(async () => makePlan());
    const onRun = vi.fn(async () => ({
      profiles: new Map([
        ["c1", { verdict: "supported" as const, entries: [], checkedAt: "t", checkedBy: "m", claimHash: "h" }],
      ]),
      interrupted: false,
    }));
    render(
      <LocaleProvider>
        <Harness onPlan={onPlan} onRun={onRun as never} />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByText("Review plan"));
    await screen.findByText("2 target(s) · 1 model call(s)");
    fireEvent.click(screen.getByText("Run"));

    await waitFor(() => expect(onRun).toHaveBeenCalled());
    expect(await screen.findByText("Checked 1 claim(s)/topic(s)")).toBeTruthy();
  });

  it("対象 0 件のときは実行ボタンを無効化する", async () => {
    const onPlan = vi.fn(async () => makePlan({}, 0));
    render(
      <LocaleProvider>
        <Harness onPlan={onPlan} onRun={vi.fn() as never} />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByText("Review plan"));
    await screen.findByText("0 target(s) · 1 model call(s)");
    expect((screen.getByText("Run").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("中断すると onCancel が呼ばれる", async () => {
    const onCancel = vi.fn();
    let resolveRun!: (v: BatchRunResult) => void;
    const onPlan = vi.fn(async () => makePlan());
    const onRun = vi.fn(() => new Promise<BatchRunResult>((resolve) => { resolveRun = resolve; }));
    render(
      <LocaleProvider>
        <Harness onPlan={onPlan} onRun={onRun as never} onCancel={onCancel} />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByText("Review plan"));
    await screen.findByText("2 target(s) · 1 model call(s)");
    fireEvent.click(screen.getByText("Run"));
    await screen.findByText("Stop");
    fireEvent.click(screen.getByText("Stop"));
    expect(onCancel).toHaveBeenCalledTimes(1);

    // 後始末: pending の promise を解決してテスト終了時の警告を防ぐ
    resolveRun({ profiles: new Map(), interrupted: true });
    await waitFor(() => expect(onRun).toHaveBeenCalled());
  });

  it("実行中は進捗表示・完了サマリに aria-live=\"polite\" が付く", async () => {
    let resolveRun!: (v: BatchRunResult) => void;
    const onPlan = vi.fn(async () => makePlan());
    const onRun = vi.fn(() => new Promise<BatchRunResult>((resolve) => { resolveRun = resolve; }));
    render(
      <LocaleProvider>
        <Harness onPlan={onPlan} onRun={onRun as never} />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByText("Review plan"));
    await screen.findByText("2 target(s) · 1 model call(s)");
    fireEvent.click(screen.getByText("Run"));
    const runningRegion = await screen.findByText("Stop");
    expect(runningRegion.closest('[aria-live="polite"]')).toBeTruthy();

    resolveRun({ profiles: new Map(), interrupted: false });
    const doneText = await screen.findByText("Checked 0 claim(s)/topic(s)");
    expect(doneText.closest('[aria-live="polite"]')).toBeTruthy();
  });

  it("画面を離れて戻っても running/result が props から復元される（ローカル state に置かない）", async () => {
    const onPlan = vi.fn(async () => makePlan());
    // running=true, progress あり、result=null の状態でいきなりマウントする
    // （フックが保持していた state をそのまま props として渡す想定）。
    const { unmount } = render(
      <LocaleProvider>
        <SourceCheckLintSection
          onPlan={onPlan}
          onRun={vi.fn() as never}
          onCancel={() => {}}
          running
          progress={{ index: 1, total: 4 }}
          result={null}
          onDismissResult={() => {}}
        />
      </LocaleProvider>,
    );

    expect(screen.getByText("Checking source 2/4…")).toBeTruthy();
    expect(screen.getByText("Stop")).toBeTruthy();
    unmount();
  });
});
