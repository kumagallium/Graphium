// 手入れ画面の「足りないところを補う」「全体をやり直す」の節のストーリー。
// 設定の「ナレッジ管理」タブにあった一括処理を手入れ画面に集めたときの見え方を、部品ごとに確かめる。
// 操作は console.info を鳴らすだけ（AI・保存は呼ばない）。数はパン作りの見本の規模に合わせた架空の値。

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider, syncLocale, useT } from "../../i18n";
import { UpkeepFillGapsSection, UpkeepOneByOneDivider, UpkeepRebuildSection, type UpkeepJob } from "./UpkeepJobSections";
import { BulkRegenerateBlock, type BulkRegenerateProgressView } from "./BulkRegenerateBlock";
import { AutoUpkeepPanel } from "./AutoUpkeepPanel";
import "../../app.css";

const meta: Meta = {
  title: "Molecules/UpkeepJobSections",
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "手入れ画面に集めた一括処理。「足りないところを補う」は対象があるときだけ開いた状態で出し、「全体をやり直す」はたたんで一番下に置く。どの行も、押すと AI を呼ぶ回数を確かめてから始める。",
      },
    },
  },
  decorators: [
    (Story) => {
      syncLocale("ja");
      return (
        <LocaleProvider>
          <div style={{ maxWidth: 720, background: "var(--paper-2)" }}>
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
};
export default meta;

type Story = StoryObj;

const log = (what: string) => () => console.info(`[UpkeepJobSections] ${what}`);

/** 補う 4 行（何もしていない状態） */
function useIdleFillGapJobs(): UpkeepJob[] {
  const t = useT();
  return [
    {
      id: "sourceTopics",
      title: t("settings.maintenance.sourceTopics.title"),
      help: t("settings.maintenance.sourceTopics.help", { sources: "12" }),
      status: { kind: "idle" },
      runLabel: t("settings.maintenance.sourceTopics.run"),
      onRun: log("sourceTopics.run"),
    },
    {
      id: "linkClaims",
      title: t("settings.maintenance.linkClaimsToTopics.title"),
      help: t("settings.maintenance.linkClaimsToTopics.help", { claims: "48" }),
      status: { kind: "idle" },
      runLabel: t("settings.maintenance.linkClaimsToTopics.run"),
      onRun: log("linkClaims.run"),
    },
    {
      id: "topicTypes",
      title: t("settings.maintenance.assignTopicTypes.title"),
      help: t("settings.maintenance.assignTopicTypes.help", { count: "23" }),
      status: { kind: "idle" },
      runLabel: t("settings.maintenance.assignTopicTypes.run"),
      onRun: log("topicTypes.run"),
    },
    {
      id: "insights",
      title: t("settings.maintenance.atomize.title"),
      help: t("settings.maintenance.atomize.help", { count: "64" }),
      status: { kind: "idle" },
      runLabel: t("settings.maintenance.atomize.run"),
      onRun: log("insights.run"),
    },
  ];
}

export const FillGapsIdle: Story = {
  name: "補う: 対象があるとき",
  render: () => <UpkeepFillGapsSection jobs={useIdleFillGapJobs()} />,
};

function MixedStates() {
  const t = useT();
  const idle = useIdleFillGapJobs();
  const jobs: UpkeepJob[] = [
    {
      ...idle[0],
      help: t("settings.maintenance.sourceTopics.help", { sources: "12" }),
      status: {
        kind: "running",
        text: t("settings.maintenance.sourceTopics.running", { done: "3", total: "12", topics: "5" }),
        done: 3,
        total: 12,
      },
      onStop: log("sourceTopics.stop"),
      stopLabel: t("settings.maintenance.sourceTopics.stop"),
    },
    { ...idle[1], disabled: true },
    {
      ...idle[2],
      help: undefined,
      onRun: undefined,
      status: {
        kind: "result",
        tone: "ok",
        text: t("settings.maintenance.assignTopicTypes.done", { assigned: "23", total: "23", calls: "1" }),
      },
    },
    {
      ...idle[3],
      status: {
        kind: "result",
        tone: "ok",
        text: t("settings.maintenance.atomize.doneCount", { count: "4" }),
      },
    },
  ];
  return <UpkeepFillGapsSection jobs={jobs} />;
}

export const FillGapsMixed: Story = {
  name: "補う: 実行中・結果・待ち",
  render: () => <MixedStates />,
};

function RegenHarness({ progress, running = false }: { progress?: BulkRegenerateProgressView; running?: boolean }) {
  const t = useT();
  const [kinds, setKinds] = useState(new Set(["topic"]));
  const counts: Record<string, number> = { topic: 41, claim: 186, atom: 12 };
  const labels: Record<string, string> = {
    topic: t("settings.maintenance.kind.topic"),
    claim: t("settings.maintenance.kind.claim"),
    atom: t("settings.maintenance.kind.atom"),
  };
  const target = [...kinds].reduce((s, k) => s + (counts[k] ?? 0), 0);
  const models = [
    { value: "model-a", label: "model-a (default)" },
    { value: "model-b", label: "model-b" },
  ];
  return (
    <BulkRegenerateBlock
      kinds={Object.keys(counts).map((k) => ({ kind: k, label: labels[k], count: counts[k], checked: kinds.has(k) }))}
      onToggleKind={(k) =>
        setKinds((prev) => {
          const next = new Set(prev);
          if (next.has(k)) next.delete(k);
          else next.add(k);
          return next;
        })
      }
      models={models}
      ingestModel="model-a"
      onIngestModelChange={log("ingestModel")}
      synthesisModel="model-a"
      onSynthesisModelChange={log("synthesisModel")}
      targetCount={target}
      totalCount={239}
      estimatedCalls={kinds.has("topic") ? target + 57 : target}
      progress={progress ?? null}
      running={running}
      cancelling={false}
      onRun={log("regen.run")}
      onCancel={log("regen.cancel")}
      onRetryFailed={log("regen.retry")}
    />
  );
}

function useLegacyRow(): UpkeepJob {
  const t = useT();
  return {
    id: "legacyTopics",
    title: t("wikiLint.legacyTopics.summary", { count: "3" }),
    status: { kind: "idle" },
    runLabel: t("wikiLint.legacyTopics.action"),
    onRun: log("legacy.run"),
  };
}

export const RebuildOpen: Story = {
  name: "やり直す: 開いたところ（おまかせが使えないときは旧形式の行も出る）",
  render: () => (
    <UpkeepRebuildSection jobs={[useLegacyRow()]} defaultOpen>
      <RegenHarness />
    </UpkeepRebuildSection>
  ),
};

export const RebuildRunningWithFailures: Story = {
  name: "やり直す: 実行中と失敗",
  render: () => (
    <div className="space-y-4">
      <UpkeepRebuildSection jobs={[]} defaultOpen>
        <RegenHarness
          running
          progress={{ done: 17, total: 41, failed: 1, current: "一次発酵の目安", currentModel: "model-a", failedItems: [] }}
        />
      </UpkeepRebuildSection>
      <UpkeepRebuildSection jobs={[]} defaultOpen>
        <RegenHarness
          progress={{
            done: 41,
            total: 41,
            failed: 2,
            failedItems: [
              { id: "t1", title: "全粒粉の吸水", error: "timeout" },
              { id: "t2", title: "バターを入れる時機", error: "rate limit" },
            ],
          }}
        />
      </UpkeepRebuildSection>
    </div>
  ),
};

/** 手入れタブでの並び（おまかせ → 補う → 手動で点検する → 全体をやり直す） */
function ViewOrder() {
  const t = useT();
  const fold = (label: string) => (
    <div className="px-4 pt-3 pb-1">
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <ChevronDown size={13} className="-rotate-90" />
        {label}
      </span>
    </div>
  );
  return (
    <div className="border border-border rounded-md">
      <AutoUpkeepPanel progress={null} result={null} onRun={log("autoTidy.run")} />
      <UpkeepOneByOneDivider />
      <UpkeepFillGapsSection jobs={useIdleFillGapJobs().slice(0, 2)} />
      {fold(t("autoTidy.manual.header"))}
      {fold(t("autoSourceCheck.manual.header"))}
      <UpkeepRebuildSection jobs={[]}>
        <RegenHarness />
      </UpkeepRebuildSection>
      <div className="h-3" />
    </div>
  );
}

export const InUpkeepView: Story = {
  name: "手入れタブでの並び",
  render: () => <ViewOrder />,
};
