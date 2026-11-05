// AutoUpkeepPanel（おまかせで整える — 手入れ画面の冒頭の欄）のストーリー。
// 初期状態・点検中・照合中（中断ボタンあり）・完了（内訳を開いた状態）・中断された、を単独で確認する。
// 操作は console.info を鳴らすだけ。デモデータはパン作りの世界観。

import { useEffect, useRef } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider, syncLocale } from "../../i18n";
import { AutoUpkeepPanel } from "./AutoUpkeepPanel";
import type { AutoUpkeepResult } from "./auto-upkeep";
import "../../app.css";

const meta: Meta = {
  title: "Molecules/AutoUpkeepPanel",
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "手入れ画面の冒頭の欄。点検 → 手当て → 出典照合 → 手当て を 1 つのボタンで通す。終わったあとは件数だけを見せ、内訳（実行内容）はたたむ。中断できるのは出典照合の最中だけ。",
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

const doneResult: AutoUpkeepResult = {
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
    { step: { kind: "rewrite", wikiId: "t4", title: "バターを入れる時機" }, ok: true },
    { step: { kind: "reconcile", wikiId: "t5", title: "一次発酵の目安" }, ok: true, stillFlagged: true },
  ],
  checkedCount: 9,
  finishedAt: "2026-11-04T07:30:00Z",
};

/** マウント後、指定テキストのボタンを順にクリックする（内訳を開いた状態の再現用） */
function Harness({ openLabels = [], children }: { openLabels?: string[]; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const label of openLabels) {
        if (cancelled) return;
        await new Promise((r) => setTimeout(r, 50));
        Array.from(ref.current?.querySelectorAll("button") ?? [])
          .find((b) => b.textContent === label)
          ?.click();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={ref}>{children}</div>;
}

const common = {
  onRun: () => console.info("[story] run"),
  onCancel: () => console.info("[story] cancel"),
  onShowOperations: () => console.info("[story] operations"),
  onOpenWiki: (id: string) => console.info("[story] open wiki", id),
};

export const Idle: Story = {
  name: "初期状態",
  render: () => <AutoUpkeepPanel {...common} progress={null} result={null} />,
};

export const Checking: Story = {
  name: "点検中（中断ボタンあり）",
  render: () => <AutoUpkeepPanel {...common} progress={{ phase: "checking" }} result={null} />,
};

export const SourceChecking: Story = {
  name: "照合中（中断ボタンあり）",
  render: () => <AutoUpkeepPanel {...common} progress={{ phase: "sourceChecking", index: 2, total: 7 }} result={null} />,
};

export const DoneExpanded: Story = {
  name: "完了（内訳を開いた状態）",
  render: () => (
    <Harness openLabels={["実行内容"]}>
      <AutoUpkeepPanel {...common} progress={null} result={doneResult} />
    </Harness>
  ),
};

export const Interrupted: Story = {
  name: "中断された",
  render: () => (
    <AutoUpkeepPanel
      {...common}
      progress={null}
      result={{ ...doneResult, sourceCheck: [], checkedCount: 4, interrupted: true }}
    />
  ),
};
