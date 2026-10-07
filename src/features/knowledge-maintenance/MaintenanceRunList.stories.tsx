// MaintenanceRunList — 保守の操作の一覧のカタログ
// 各ストーリーの右上のボタンで日本語 / English を切り替えて文言を確かめる。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useLocale } from "../../i18n";
import { MaintenanceRunList } from "./MaintenanceRunList";
import { operationKey, type OperationStateInfo } from "./run-format";
import type { MaintenanceOperation, MaintenanceRun, MaintenanceTrigger } from "./types";

const noop = () => {};
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

function op(over: Partial<MaintenanceOperation> & { id: string }): MaintenanceOperation {
  return { kind: "merge_topics", startedAt: ago(5), related: [], pages: [], flags: [], status: "applied", ...over };
}
function run(id: string, trigger: MaintenanceTrigger, min: number, operations: MaintenanceOperation[]): MaintenanceRun {
  return { formatVersion: 1, id, startedAt: ago(min), trigger, actor: { via: "app" }, operations };
}

const singles: MaintenanceRun[] = [
  run("r1", "merge_topics", 5, [
    op({
      id: "o1",
      startedAt: ago(5),
      subject: { wikiId: "w-knead", title: "こね時間と生地温度" },
      related: [{ wikiId: "w-knead2", title: "こねすぎの見分け方", role: "absorbed" }],
    }),
  ]),
  run("r2", "regenerate", 90, [
    op({ id: "o2", kind: "regenerate", startedAt: ago(90), subject: { wikiId: "w-hyd", title: "加水率と食感の関係" } }),
  ]),
  run("r3", "bulk_archive", 60 * 26, [
    op({
      id: "o3",
      kind: "archive",
      startedAt: ago(60 * 26),
      related: [{ wikiId: "w-old", title: "ドライイーストの量（旧）", role: "archived" }],
    }),
  ]),
  run("r4", "restore_version", 60 * 50, [
    op({ id: "o4", kind: "restore_version", startedAt: ago(60 * 50), subject: { wikiId: "w-knead", title: "こね時間と生地温度" } }),
  ]),
];

// 話題の整理: 1 実行に組ごとの操作が複数
const organize: MaintenanceRun = run("r0", "organize_topics", 3, [
  op({
    id: "oa",
    startedAt: ago(3),
    subject: { wikiId: "w-ferment", title: "一次発酵の見極め" },
    related: [{ wikiId: "w-f2", title: "発酵の目安", role: "absorbed" }, { wikiId: "w-f3", title: "発酵時間の目安", role: "absorbed" }],
  }),
  op({
    id: "ob",
    startedAt: ago(3),
    subject: { wikiId: "w-shape", title: "成形のコツ" },
    related: [{ wikiId: "w-s2", title: "丸め方", role: "absorbed" }],
  }),
  op({
    id: "oc",
    startedAt: ago(2),
    subject: { wikiId: "w-bake", title: "焼成温度と焼き色" },
    related: [{ wikiId: "w-b2", title: "オーブン温度の目安", role: "absorbed" }],
  }),
]);

const noStates = new Map<string, OperationStateInfo>();
const noBlockers = () => [];

function LocaleToggle({ children }: { children: React.ReactNode }) {
  const { locale, setLocale } = useLocale();
  return (
    <div className="max-w-md">
      <div className="mb-2 flex justify-end gap-1 text-xs">
        {(["ja", "en"] as const).map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={locale === l}
            className={`rounded-full border px-2 py-0.5 ${locale === l ? "border-primary bg-primary/10 text-foreground" : "border-border-subtle text-muted-foreground"}`}
            onClick={() => setLocale(l)}
          >
            {l === "ja" ? "日本語" : "English"}
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}

const meta: Meta<typeof MaintenanceRunList> = {
  title: "Features/KnowledgeMaintenance/MaintenanceRunList",
  component: MaintenanceRunList,
  parameters: { layout: "padded" },
  decorators: [(Story) => <LocaleToggle>{Story()}</LocaleToggle>],
  args: { runs: singles, states: noStates, blockersOf: noBlockers, onUndo: noop, onOpenPage: noop },
};
export default meta;

type Story = StoryObj<typeof MaintenanceRunList>;

export const OneByOne: Story = { name: "1 件ずつの実行が並ぶ" };

export const MultiOperationRun: Story = {
  name: "1 実行に複数の操作（話題の整理）",
  args: { runs: [organize, ...singles] },
};

// いろいろな状態が混ざる（取り消し済み・一部だけ・途中で止まった・先に取り消す必要あり）
export const MixedStates: Story = {
  name: "状態が混ざる",
  render: (args) => {
    const states = new Map<string, OperationStateInfo>([
      [operationKey("r1", "o1"), { state: "undone", undoneBy: { runId: "rx", operationId: "ox" } }],
      [operationKey("r2", "o2"), { state: "undo_partial", undoneBy: { runId: "rx", operationId: "oy" } }],
      [operationKey("r3", "o3"), { state: "interrupted" }],
    ]);
    const blockers = (t: { runId: string; operationId: string }) =>
      t.operationId === "o4" ? [{ runId: "r1", operationId: "o1", op: singles[0].operations[0] }] : [];
    return <MaintenanceRunList {...args} states={states} blockersOf={blockers} />;
  },
};

export const WithLoadMore: Story = {
  name: "さらに読み込む",
  args: { hasMore: true, onLoadMore: noop },
};

export const Loading: Story = { name: "読み込み中", args: { runs: [], loading: true } };

export const Empty: Story = { name: "空", args: { runs: [] } };

export const WithUnreadable: Story = {
  name: "読めない実行あり",
  args: { unreadableCount: 2, hasMore: true, onLoadMore: noop },
};

export const FilteredByPage: Story = {
  name: "ページで絞り込み（こね時間と生地温度）",
  args: { runs: [organize, ...singles], filterWikiId: "w-knead" },
};

export const FilteredEmpty: Story = {
  name: "ページで絞り込み（該当なし）",
  args: { filterWikiId: "w-none" },
};

export const Undoing: Story = {
  name: "取り消しを実行中",
  args: { undoingKey: operationKey("r2", "o2") },
};
