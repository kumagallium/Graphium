// WikiLintView（点検 / 出典照合の 2 タブ構成, 案 A）のストーリー。
// 既定タブ（点検）の開始画面、出典照合タブの開始画面・計画・実行中・完了を、
// タブを実際に切り替えて確認できるようにする。API・保存は一切呼ばず、モック関数のみで
// 状態遷移をシミュレートする（自動クリックはボタンの DOM 操作のみ）。

import { useCallback, useEffect, useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider, syncLocale } from "../../i18n";
import { WikiLintView } from "./WikiLintView";
import type { SourceCheckLintSectionProps } from "./SourceCheckLintSection";
import type { BatchRunResult, LintPlanResult } from "../source-check/use-source-check";
import "../../app.css";

const meta: Meta = {
  title: "Organisms/WikiLintView",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "ナレッジの手入れ画面。既定の「点検」タブ（クイック/フル）と、別レーンの「出典照合」タブをタブで切り替える（案 A）。両タブとも開始画面は中央揃えの同じレイアウトにする。",
      },
    },
  },
  decorators: [
    (Story) => {
      syncLocale("ja");
      return (
        <LocaleProvider>
          <div style={{ height: 480, background: "var(--paper-2)" }}>
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
function useSourceCheckHarness(onPlan: SourceCheckLintSectionProps["onPlan"]): SourceCheckLintSectionProps {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ index: number; total: number } | null>(null);
  const [result, setResult] = useState<BatchRunResult | null>(null);

  const onRun = useCallback(async (plan: LintPlanResult): Promise<BatchRunResult> => {
    setRunning(true);
    setProgress({ index: 0, total: plan.plan.groups.length || 1 });
    try {
      // 実 API は呼ばない。固定の結果を模す。
      const r: BatchRunResult = {
        profiles: new Map([
          ["c1", { verdict: "supported" as const, entries: [], checkedAt: "2026-09-17T00:00:00Z", checkedBy: "m", claimHash: "h1" }],
        ]),
        interrupted: false,
      };
      setResult(r);
      return r;
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }, []);

  return {
    onPlan,
    onRun,
    onCancel: () => console.info("[story] cancel"),
    running,
    progress,
    result,
    onDismissResult: () => setResult(null),
  };
}

/** マウント後、指定テキストのボタンを順番にクリックする（実 API・保存は呼ばない）。 */
function useAutoClickSequence(containerRef: React.RefObject<HTMLDivElement | null>, labels: string[]) {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const label of labels) {
        if (cancelled) return;
        // 直前のクリックで生えた DOM が反映されるのを少し待つ
        await new Promise((r) => setTimeout(r, 50));
        const btn = Array.from(containerRef.current?.querySelectorAll("button") ?? []).find(
          (b) => b.textContent === label,
        );
        btn?.click();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function Harness({ autoClickLabels = [] }: { autoClickLabels?: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const sourceCheckProps = useSourceCheckHarness(async () => makePlan(6, 3));
  useAutoClickSequence(ref, autoClickLabels);

  return (
    <div ref={ref} style={{ height: "100%" }}>
      <WikiLintView
        report={null}
        loading={false}
        onRunLint={() => console.info("[story] run lint")}
        onOpenWiki={() => console.info("[story] open wiki")}
        onBack={() => console.info("[story] back")}
        sourceCheckProps={sourceCheckProps}
      />
    </div>
  );
}

// 既定タブ（点検）の開始画面。
export const CheckTabEmpty: Story = {
  name: "点検タブ — 初期状態",
  render: () => <Harness />,
};

// 「出典照合」タブに切り替えた直後の開始画面（対象・範囲の選択 + 「計画を確認」ボタン）。
export const SourceCheckTabEmpty: Story = {
  name: "出典照合タブ — 初期状態",
  render: () => <Harness autoClickLabels={["出典照合"]} />,
};

// タブ切り替え → 計画を確認、で対象件数・判定回数のプレビューを見る。
export const SourceCheckTabPlanned: Story = {
  name: "出典照合タブ — 計画確認",
  render: () => <Harness autoClickLabels={["出典照合", "計画を確認"]} />,
};

// タブ切り替え → 計画を確認 → 実行、で進捗表示（すぐ完了に遷移するのでスクリーンショットは実行直後の一瞬）。
// 実行中の見た目自体は SourceCheckLintSection のストーリー（Running）で個別に確認できる。
export const SourceCheckTabDone: Story = {
  name: "出典照合タブ — 完了",
  render: () => <Harness autoClickLabels={["出典照合", "計画を確認", "実行"]} />,
};
