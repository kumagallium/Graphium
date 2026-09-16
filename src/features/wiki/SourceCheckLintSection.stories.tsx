// SourceCheckLintSection（出典照合の点検欄, v1.1 / 仕様 2-b）のストーリー。
// 既存の「クイック / フル」点検（WikiLintView 本体）とは別レーンの欄であることを、
// 単独で見た目を確認できるようにする（点検欄のストーリーは仕様上必須）。
//
// running / progress / result は useSourceCheck フックの state（レビュー指摘で
// ローカル state から移した）。ストーリーでは Harness コンポーネントで同じ state 遷移を
// 模して、実行中・完了の見た目を再現する。

import { useCallback, useEffect, useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider, syncLocale } from "../../i18n";
import { SourceCheckLintSection, type SourceCheckLintSectionProps } from "./SourceCheckLintSection";
import type { BatchRunResult, LintPlanResult } from "../source-check/use-source-check";
import "../../app.css";

const meta: Meta = {
  title: "Molecules/SourceCheckLintSection",
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "出典照合の点検欄。既存の「クイック / フル」点検（WikiLintView）とは別レーンで、自動点検（ingest 直後・起動時）には一切つながず、ここからの実行だけを起点にする。対象（知見/トピック/両方）と範囲（未照合/本文変更/すべて）を選び、計画（対象件数・判定回数・照合できない内訳）を確認してから実行する。実行中かどうか・進捗・完了結果はフック（useSourceCheck）の state から受け取るため、画面を離れて戻っても状態が保たれる。",
      },
    },
  },
  decorators: [
    (Story) => {
      syncLocale("ja");
      return (
        <LocaleProvider>
          <div style={{ background: "var(--paper-2)", maxWidth: 480 }}>
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
};
export default meta;

type Story = StoryObj;

function makePlan(targetCount: number, llmCalls: number, missingCounts: Record<string, number> = {}): LintPlanResult {
  return {
    plan: {
      groups: [],
      knownMissing: [],
      llmCalls,
      statementCount: targetCount,
      docCount: targetCount,
      missingCounts: missingCounts as never,
    },
    statementsById: new Map(),
    targetCount,
  };
}

/** useSourceCheck.batchRunning/batchProgress/batchResult 相当を模すハーネス。 */
function Harness({
  onPlan,
  onRun,
}: {
  onPlan: SourceCheckLintSectionProps["onPlan"];
  onRun: (plan: LintPlanResult) => Promise<BatchRunResult>;
}) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ index: number; total: number } | null>(null);
  const [result, setResult] = useState<BatchRunResult | null>(null);

  const run = useCallback(
    async (plan: LintPlanResult) => {
      setRunning(true);
      setProgress({ index: 0, total: plan.plan.groups.length || 1 });
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
      onCancel={() => console.info("[story] cancel")}
      running={running}
      progress={progress}
      result={result}
      onDismissResult={() => setResult(null)}
    />
  );
}

// 初期状態（対象・範囲の選択 + 「計画を確認」ボタンのみ）を実際にレンダリングして確認する。
export const Idle: Story = {
  name: "初期状態",
  render: () => (
    <Harness
      onPlan={async () => makePlan(12, 5)}
      onRun={async () => ({ profiles: new Map(), interrupted: false })}
    />
  ),
};

// 「計画を確認」ボタンをマウント直後に自動で 1 回押し、計画確認後の表示
// （対象件数・判定回数・照合できない内訳）を見えるようにする。play 関数を使わず
// useEffect + ref.click() で行う（@storybook/test は未導入のため使わない）。
function AutoClick({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const btn = Array.from(ref.current?.querySelectorAll("button") ?? []).find(
      (b) => b.textContent === label,
    );
    btn?.click();
  }, [label]);
  return <div ref={ref}>{children}</div>;
}

export const Planned: Story = {
  name: "計画確認 — 照合できない内訳あり",
  render: () => (
    <AutoClick label="計画を確認">
      <Harness
        onPlan={async () => makePlan(12, 5, { "ai-answer": 2, "not-recorded": 1 })}
        onRun={async () => ({ profiles: new Map(), interrupted: false })}
      />
    </AutoClick>
  ),
};

// 実行中（進捗表示 + 中断ボタン）。onRun は永久 pending にして running 表示を固定する。
export const Running: Story = {
  name: "実行中",
  render: () => (
    <AutoClick label="計画を確認">
      <RunAfterPlan>
        <Harness onPlan={async () => makePlan(8, 3)} onRun={() => new Promise<never>(() => {})} />
      </RunAfterPlan>
    </AutoClick>
  ),
};

// AutoClick 後、少し遅れてもう一段「実行」を押す（計画確認 → 実行の 2 段階を自動で進める）。
function RunAfterPlan({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      const btn = Array.from(ref.current?.querySelectorAll("button") ?? []).find(
        (b) => b.textContent === "実行",
      );
      btn?.click();
    }, 50);
    return () => clearTimeout(timer);
  }, []);
  return <div ref={ref}>{children}</div>;
}

// 完了（verdict 別の件数）
export const Done: Story = {
  name: "完了",
  render: () => (
    <AutoClick label="計画を確認">
      <RunAfterPlan>
        <Harness
          onPlan={async () => makePlan(3, 2)}
          onRun={async () => ({
            profiles: new Map([
              [
                "c1",
                { verdict: "supported" as const, entries: [], checkedAt: "2026-09-17T00:00:00Z", checkedBy: "m", claimHash: "h1" },
              ],
              [
                "c2",
                { verdict: "not-in-source" as const, entries: [], checkedAt: "2026-09-17T00:00:00Z", checkedBy: "m", claimHash: "h2" },
              ],
            ]),
            interrupted: false,
          })}
        />
      </RunAfterPlan>
    </AutoClick>
  ),
};
