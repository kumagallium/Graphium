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

function Harness({
  autoClickLabels = [],
  withReviewList = false,
}: {
  autoClickLabels?: string[];
  /** 要確認一覧のモック（データのみ。操作は console.info を鳴らすだけ） */
  withReviewList?: boolean;
}) {
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
        sourceCheckProps={{
          ...sourceCheckProps,
          reviewList: withReviewList
            ? {
                items: [
                  { id: "c1", title: "熱電材料のゼーベック係数は温度に依存しない", kind: "claim", verdict: "contradicted" },
                  { id: "t1", title: "熱電変換の基礎", kind: "topic", verdict: "not-in-source" },
                  { id: "c2", title: "ZT 値は無次元の性能指数である", kind: "claim", verdict: "not-in-source" },
                ],
                onOpen: () => console.info("[story] open"),
                onDismiss: async () => console.info("[story] dismiss"),
                onArchive: async () => console.info("[story] archive"),
                onBulkArchive: async () => console.info("[story] bulk archive"),
                onRecheck: async () => console.info("[story] recheck"),
                runningId: null,
                batchRunning: false,
              }
            : undefined,
        }}
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

// 「要確認」一覧がある状態（開始画面の下に常設で出る）。
// AI の判定で一覧を隠さない代わりに、この別リストで目立たせる方針の確認用。
export const SourceCheckTabWithReviewList: Story = {
  name: "出典照合タブ — 要確認一覧あり",
  render: () => <Harness autoClickLabels={["出典照合"]} withReviewList />,
};

// フル点検の結果に「次に調べること」が付いた状態。既定で畳まれ、開くと問い・理由・
// 関係ページ・「チャットで聞く」ボタンが見える（issue の件数・サマリーには数えない）。
export const CheckTabWithQuestions: Story = {
  name: "点検タブ — 次に調べること",
  render: () => (
    <div style={{ height: "100%" }}>
      <WikiLintView
        report={{
          issues: [
            {
              type: "gap",
              severity: "info",
              title: "多バンド伝導に触れた知見が複数あるが、専用ページが無い",
              description: "複数のページが「多バンド伝導」に言及しているが、まとめて説明するページが無い。",
              affectedWikiIds: ["w1", "w2"],
              suggestion: "「多バンド伝導」を主題にした Claim ページを新設する。",
            },
          ],
          summary: { total: 1, contradictions: 0, orphans: 0, gaps: 1, stale: 0, redundant: 0, missingSource: 0 },
          analyzedAt: "2026-09-24T00:00:00Z",
          questions: [
            {
              question: "Ti 置換量を変えた系で熱伝導率はどう変化するか",
              why: "「Al5Co2 の熱電特性」に Ti 置換の効果が書かれておらず、書ければページの結論が変わりうる。",
              affectedWikiIds: ["w1"],
              needs: "external",
              lookFor: "Ti 置換量を振った熱伝導率の測定データ",
            },
            {
              question: "既存の 3 本の実験ノートから、多バンド伝導の温度依存の傾向をまとめられるか",
              why: "手元のノートに材料は揃っているが、横断してまとめた記述がまだ無い。",
              affectedWikiIds: ["w1", "w2"],
              needs: "internal",
            },
          ],
        }}
        loading={false}
        onRunLint={() => console.info("[story] run lint")}
        onOpenWiki={(id) => console.info("[story] open wiki", id)}
        onBack={() => console.info("[story] back")}
        wikiTitleById={new Map([["w1", "Al5Co2 の熱電特性"], ["w2", "多バンド伝導と Seebeck 係数"]])}
        onAskLintQuestion={(q) => console.info("[story] ask in chat", q.question, q.needs)}
      />
    </div>
  ),
};

// AI 解析（フル点検の LLM 呼び出し）が失敗した状態。issues/summary はクイック（機械判定）の
// 結果のみだが、「問題は見つかりませんでした」は出さず、注意枠で失敗を明示する。
export const CheckTabWithLintError: Story = {
  name: "点検タブ — AI 解析失敗",
  render: () => (
    <div style={{ height: "100%" }}>
      <WikiLintView
        report={{
          issues: [],
          summary: { total: 0, contradictions: 0, orphans: 0, gaps: 0, stale: 0, redundant: 0, missingSource: 0 },
          analyzedAt: "2026-09-24T00:00:00Z",
          lintError: "Input length (230346) exceeds model's maximum context length (131072).",
        }}
        loading={false}
        onRunLint={() => console.info("[story] run lint")}
        onOpenWiki={(id) => console.info("[story] open wiki", id)}
        onBack={() => console.info("[story] back")}
      />
    </div>
  ),
};
