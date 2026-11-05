// WikiLintView（手入れ / 手入れの履歴の 2 タブ構成）のストーリー。
// 手入れタブの開始画面、「手動で照合する」のたたみの開始画面・計画・実行中・完了を、
// タブを実際に切り替えて確認できるようにする。API・保存は一切呼ばず、モック関数のみで
// 状態遷移をシミュレートする（自動クリックはボタンの DOM 操作のみ）。

import { useCallback, useEffect, useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider, syncLocale } from "../../i18n";
import { WikiLintView } from "./WikiLintView";
import type { SourceCheckLintSectionProps } from "./SourceCheckLintSection";
import type { BatchRunResult, LintPlanResult } from "../source-check/use-source-check";
import type { MaintenanceListBinding } from "../knowledge-maintenance/MaintenanceRunList";
import type { MaintenanceOperation, MaintenanceRun } from "../knowledge-maintenance/types";
import type { AutoUpkeepProgress, AutoUpkeepResult } from "./auto-upkeep";
import "../../app.css";

const meta: Meta = {
  title: "Organisms/WikiLintView",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "ナレッジの手入れ画面。「手入れ」タブ（おまかせで整える・未対応の項目・手動で点検する・手動で照合する）と「手入れの履歴」タブ（取り消しの一覧）を切り替える。",
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

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
function demoOp(over: Partial<MaintenanceOperation> & { id: string }): MaintenanceOperation {
  return { kind: "merge_topics", startedAt: ago(5), related: [], pages: [], flags: [], status: "applied", ...over };
}
function demoRun(id: string, trigger: MaintenanceRun["trigger"], min: number, operations: MaintenanceOperation[]): MaintenanceRun {
  return { formatVersion: 1, id, startedAt: ago(min), trigger, actor: { via: "app" }, operations };
}

/** 手入れの履歴タブ用のデモデータ（パン作りの世界観。操作は console.info を鳴らすだけ） */
const demoMaintenance: MaintenanceListBinding = {
  runs: [
    demoRun("r1", "merge_topics", 5, [
      demoOp({
        id: "o1",
        subject: { wikiId: "w-knead", title: "こね時間と生地温度" },
        related: [{ wikiId: "w-knead2", title: "こねすぎの見分け方", role: "absorbed" }],
      }),
    ]),
    demoRun("r2", "regenerate", 90, [
      demoOp({ id: "o2", kind: "regenerate", startedAt: ago(90), subject: { wikiId: "w-hyd", title: "加水率と食感の関係" } }),
    ]),
    demoRun("r3", "bulk_archive", 60 * 26, [
      demoOp({
        id: "o3",
        kind: "archive",
        startedAt: ago(60 * 26),
        related: [{ wikiId: "w-old", title: "ドライイーストの量（旧）", role: "archived" }],
      }),
    ]),
  ],
  states: new Map(),
  blockersOf: () => [],
  onUndo: (t) => console.info("[story] undo", t),
  undoingKey: null,
  loading: false,
  hasMore: false,
  unreadableCount: 0,
  onLoadMore: () => console.info("[story] load more"),
  ensureLoaded: () => console.info("[story] ensure loaded"),
};

function Harness({
  autoClickLabels = [],
  withReviewList = false,
  withAutoTidy = false,
  maintenance,
}: {
  maintenance?: MaintenanceListBinding;
  autoClickLabels?: string[];
  /** 要確認一覧のモック（データのみ。操作は console.info を鳴らすだけ） */
  withReviewList?: boolean;
  /** おまかせの欄を付ける（手動で照合するはたたみの中に入る） */
  withAutoTidy?: boolean;
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
        maintenance={maintenance}
        autoTidy={
          withAutoTidy
            ? { progress: null, result: null, reportIsLeftover: false, onRun: () => console.info("[story] auto tidy") }
            : undefined
        }
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

// 手入れタブの「手動で照合する」を開いた直後の開始画面（対象・範囲の選択 + 「計画を確認」ボタン）。
export const SourceCheckTabEmpty: Story = {
  name: "手入れタブ — 手動で照合する（初期状態）",
  render: () => <Harness withAutoTidy autoClickLabels={["手動で照合する"]} />,
};

// タブ切り替え → 計画を確認、で対象件数・判定回数のプレビューを見る。
export const SourceCheckTabPlanned: Story = {
  name: "手入れタブ — 手動で照合する（計画確認）",
  render: () => <Harness withAutoTidy autoClickLabels={["手動で照合する", "計画を確認"]} />,
};

// タブ切り替え → 計画を確認 → 実行、で進捗表示（すぐ完了に遷移するのでスクリーンショットは実行直後の一瞬）。
// 実行中の見た目自体は SourceCheckLintSection のストーリー（Running）で個別に確認できる。
export const SourceCheckTabDone: Story = {
  name: "手入れタブ — 手動で照合する（完了）",
  render: () => <Harness withAutoTidy autoClickLabels={["手動で照合する", "計画を確認", "実行"]} />,
};

// 「手入れの履歴」タブ — 統合・再生成・アーカイブの取り消し一覧（タブを開いた状態）。
export const OperationsTab: Story = {
  name: "手入れの履歴タブ — 取り消しの一覧",
  render: () => <Harness autoClickLabels={["手入れの履歴"]} maintenance={demoMaintenance} />,
};

// 「要確認」一覧がある状態（開始画面の下に常設で出る）。
// AI の判定で一覧を隠さない代わりに、この別リストで目立たせる方針の確認用。
export const SourceCheckTabWithReviewList: Story = {
  name: "手入れタブ — 手動で照合する（要確認一覧あり）",
  render: () => <Harness withAutoTidy autoClickLabels={["手動で照合する"]} withReviewList />,
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

// モデルが一度に扱える量を超えた失敗（窓に分けても 1 窓が入らなかった）。生の文言の代わりに
// 理由と対処（チャットモデルに大きいモデルを割り当てる）を出す。
export const CheckTabWithContextTooLarge: Story = {
  name: "点検タブ — 一度に扱える量を超えた",
  render: () => (
    <div style={{ height: "100%" }}>
      <WikiLintView
        report={{
          issues: [],
          summary: { total: 0, contradictions: 0, orphans: 0, gaps: 0, stale: 0, redundant: 0, missingSource: 0 },
          analyzedAt: "2026-10-22T00:00:00Z",
          lintError: "Input length (84210) exceeds model's maximum context length (32768).",
          lintErrorKind: "context",
        }}
        loading={false}
        onRunLint={() => console.info("[story] run lint")}
        onOpenWiki={(id) => console.info("[story] open wiki", id)}
        onBack={() => console.info("[story] back")}
      />
    </div>
  ),
};

// 窓に分けたフル点検の一部だけが失敗した状態。できた窓の結果（ここでは冗長 1 件）は出しつつ、
// 何回に分けて何回できなかったかを伝える。
export const CheckTabWithPartialLintError: Story = {
  name: "点検タブ — 一部の窓だけ失敗",
  render: () => (
    <div style={{ height: "100%" }}>
      <WikiLintView
        report={{
          issues: [
            {
              type: "redundant",
              severity: "info",
              title: "同じ発酵温度の知見が 2 件",
              description: "「一次発酵は 27℃ で 60 分」と「27℃・1 時間の一次発酵が膨らみの基準」が同じことを言っています。",
              affectedWikiIds: ["w-a", "w-b"],
              suggestion: "どちらかに統合してください。",
            },
          ],
          summary: { total: 1, contradictions: 0, orphans: 0, gaps: 0, stale: 0, redundant: 1, missingSource: 0 },
          analyzedAt: "2026-10-22T00:00:00Z",
          lintError: "Upstream error 502 Bad Gateway",
          lintParts: { total: 5, failed: 1 },
        }}
        loading={false}
        onRunLint={() => console.info("[story] run lint")}
        onOpenWiki={(id) => console.info("[story] open wiki", id)}
        onBack={() => console.info("[story] back")}
      />
    </div>
  ),
};

// 一括アーカイブできる issue（冗長・古い）が並んだ状態。チェックボックスか行を
// ドラッグすると範囲で選べる（Shift+クリックも可）。矛盾など対象外の行は飛ばす。
// 冗長には推奨（残す/吸収）が付くので、選ぶと「推奨どおり N 件を統合」も出る。
const bulkIssue = (type: "redundant" | "stale" | "contradiction", title: string, id: string) => ({
  type,
  severity: type === "contradiction" ? ("error" as const) : ("warning" as const),
  title,
  description: "同じ内容を扱うページが複数ある。",
  affectedWikiIds: type === "redundant" ? [`${id}-keep`, id] : [id],
  suggestion: "",
  ...(type === "redundant"
    ? { recommendedAction: { type: "merge" as const, keepId: `${id}-keep`, absorbId: id, reason: "名前が同じで、知見の多い方を残す。" } }
    : {}),
});
export const CheckTabBulkSelect: Story = {
  name: "点検タブ — ドラッグで複数選択・まとめて統合",
  render: () => (
    <div style={{ height: "100%" }}>
      <WikiLintView
        report={{
          issues: [
            bulkIssue("redundant", "「こね時間」と「こね時間」が同じトピック", "w1"),
            bulkIssue("redundant", "「加水率」と「加水率 」が同じトピック", "w2"),
            bulkIssue("contradiction", "一次発酵の温度が矛盾", "w3"),
            bulkIssue("redundant", "「オートリーズ」が重複", "w4"),
            bulkIssue("stale", "「ドライイーストの量（旧）」が古い", "w5"),
            bulkIssue("redundant", "「クラム」が重複", "w6"),
          ],
          summary: { total: 6, contradictions: 1, orphans: 0, gaps: 0, stale: 1, redundant: 4, missingSource: 0 },
          analyzedAt: "2026-09-24T00:00:00Z",
        }}
        loading={false}
        onRunLint={() => console.info("[story] run lint")}
        onOpenWiki={(id) => console.info("[story] open wiki", id)}
        onBack={() => console.info("[story] back")}
        onBulkArchiveWikis={async (ids) => console.info("[story] bulk archive", ids)}
        wikiKindById={new Map(["w1", "w1-keep", "w2", "w2-keep", "w4", "w4-keep", "w6", "w6-keep"].map((id) => [id, "topic"]))}
        onMergeTopics={async (keepId, absorbId) => {
          console.info("[story] merge", keepId, absorbId);
          await new Promise((r) => setTimeout(r, 600));
        }}
      />
    </div>
  ),
};

// ---- おまかせで整える（AI が点検から手当てまで通しで行う） ----

const tidyTitles = new Map([
  ["t1", "生地の一次発酵"], ["t2", "一次発酵の温度"], ["t3", "全粒粉の吸水"],
  ["c1", "加水率と気泡の大きさ"], ["a1", "塩は発酵を遅らせる"], ["a2", "塩を入れても発酵は変わらない"], ["o1", "古いオーブンの癖"],
]);

const tidyResult: AutoUpkeepResult = {
  tidy: [
    { step: { kind: "merge", mergeKind: "topic", keepId: "t1", absorbId: "t2" }, title: "生地の一次発酵", absorbedTitle: "一次発酵の温度", ok: true },
    { step: { kind: "rebuild", wikiId: "t3" }, title: "全粒粉の吸水", ok: true },
    {
      step: {
        kind: "reconcile",
        wikiId: "a1",
        conflicts: [{ otherWikiId: "a2", otherTitle: "塩を入れても発酵は変わらない", summary: "塩の量の条件が違う" }],
      },
      title: "塩は発酵を遅らせる",
      ok: true,
    },
    { step: { kind: "archive", wikiId: "o1" }, title: "古いオーブンの癖", ok: true },
  ],
  sourceCheck: [
    { step: { kind: "archive", wikiId: "c2", title: "強力粉は 30 分こねる" }, ok: true },
    { step: { kind: "reconcile", wikiId: "t4", title: "バターを入れる時機" }, ok: true },
    { step: { kind: "reconcile", wikiId: "t5", title: "一次発酵の目安" }, ok: true, stillFlagged: true },
  ],
  checkedCount: 9,
  finishedAt: "2026-11-04T07:30:00Z",
};

const tidyLeftoverReport = {
  issues: [
    {
      type: "contradiction" as const,
      severity: "error" as const,
      title: "塩と発酵の速さについて、2 つのページが逆のことを言っている",
      description: "「塩は発酵を遅らせる」と「塩を入れても発酵は変わらない」が食い違っています。",
      affectedWikiIds: ["a1", "a2"],
      suggestion: "元のノートの条件（塩の量）を見比べる",
    },
    {
      type: "orphan" as const,
      severity: "info" as const,
      title: "「古いオーブンの癖」がどのページともつながっていない",
      description: "どのトピックにも入っていません。",
      affectedWikiIds: ["o1"],
      suggestion: "残すか片付けるかを決める",
    },
  ],
  summary: { total: 2, contradictions: 1, orphans: 1, gaps: 0, stale: 0, redundant: 0, missingSource: 0 },
  analyzedAt: "2026-11-04T07:29:00Z",
};

function TidyView(props: { progress?: AutoUpkeepProgress | null; result?: AutoUpkeepResult | null; leftover?: boolean; reviewList?: boolean }) {
  return (
    <div style={{ height: "100%" }}>
      <WikiLintView
        report={props.leftover ? tidyLeftoverReport : null}
        loading={false}
        onRunLint={() => console.info("[story] run lint")}
        onOpenWiki={(id) => console.info("[story] open wiki", id)}
        onBack={() => console.info("[story] back")}
        wikiTitleById={tidyTitles}
        maintenance={demoMaintenance}
        legacyTopics={[{ id: "t3", title: "全粒粉の吸水" }]}
        autoTidy={{
          progress: props.progress ?? null,
          result: props.result ?? null,
          reportIsLeftover: Boolean(props.leftover),
          onRun: () => console.info("[story] auto tidy"),
          onCancel: () => console.info("[story] cancel"),
          reviewList: props.reviewList
            ? {
                items: [{ id: "t6", title: "ベンチタイムの長さ", kind: "topic", verdict: "not-in-source" }],
                onOpen: () => console.info("[story] open"),
                onDismiss: async () => console.info("[story] dismiss"),
                onArchive: async () => console.info("[story] archive"),
                onBulkArchive: async () => console.info("[story] bulk archive"),
                onRecheck: async () => console.info("[story] recheck"),
              }
            : undefined,
        }}
      />
    </div>
  );
}

// 開いた直後。押すのは 1 つだけ。従来の点検は「自分で点検して選ぶ」にたたむ
export const AutoTidyIdle: Story = {
  name: "おまかせ — 初期状態",
  render: () => <TidyView />,
};

export const AutoTidyRunning: Story = {
  name: "おまかせ — 整えている途中",
  render: () => <TidyView progress={{ phase: "fixing", done: 2, total: 5 }} />,
};

// 終わったあと。件数だけを見せ、内訳と「見るとよいもの」はたたむ
export const AutoTidyDone: Story = {
  name: "おまかせ — 完了（未対応の項目 2 件）",
  render: () => <TidyView result={tidyResult} leftover />,
};

// 完了後、内訳と残りを開いた状態
export const AutoTidyDoneExpanded: Story = {
  name: "おまかせ — 完了（内訳と残りを開く）",
  render: () => {
    function Opened() {
      const ref = useRef<HTMLDivElement>(null);
      useAutoClickSequence(ref, ["実行内容", "未対応の項目 2 件"]);
      return <div ref={ref} style={{ height: "100%" }}><TidyView result={tidyResult} leftover /></div>;
    }
    return <Opened />;
  },
};

// 要確認の行（出典照合の残り）が未対応の中に出る
export const AutoTidyDoneWithReviewList: Story = {
  name: "おまかせ — 完了（要確認の行つき）",
  render: () => {
    function Opened() {
      const ref = useRef<HTMLDivElement>(null);
      useAutoClickSequence(ref, ["未対応の項目 3 件"]);
      return <div ref={ref} style={{ height: "100%" }}><TidyView result={tidyResult} leftover reviewList /></div>;
    }
    return <Opened />;
  },
};

export const AutoTidyNothing: Story = {
  name: "おまかせ — 整えるところなし",
  render: () => <TidyView result={{ tidy: [], sourceCheck: [], checkedCount: 0, finishedAt: "2026-11-04T07:30:00Z" }} />,
};
