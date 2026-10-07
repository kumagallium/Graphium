// MaintenanceOperationRow — 保守の操作の 1 行のカタログ
// 上のツールバーではなく、各ストーリーの右上のボタンで日本語 / English を切り替えて文言を確かめる。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useLocale } from "../../i18n";
import { MaintenanceOperationRow } from "./MaintenanceOperationRow";
import type { MaintenanceOperation, MaintenanceOperationState } from "./types";

const noop = () => {};
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const base = { endedAt: undefined, pages: [], flags: [], status: "applied" as const };

const mergeTopics: MaintenanceOperation = {
  ...base,
  id: "op-mt",
  kind: "merge_topics",
  startedAt: ago(5),
  subject: { wikiId: "w-knead", title: "こね時間と生地温度" },
  related: [
    { wikiId: "w-knead2", title: "こねすぎの見分け方", role: "absorbed" },
    { wikiId: "w-knead3", title: "生地の捏ね上げ温度", role: "absorbed" },
  ],
};
const mergeAtoms: MaintenanceOperation = {
  ...base,
  id: "op-ma",
  kind: "merge_atoms",
  startedAt: ago(40),
  subject: { wikiId: "w-ferment", title: "一次発酵の見極め" },
  related: [{ wikiId: "w-ferment2", title: "発酵は倍の大きさが目安", role: "absorbed" }],
};
const regenerate: MaintenanceOperation = {
  ...base,
  id: "op-rg",
  kind: "regenerate",
  startedAt: ago(130),
  subject: { wikiId: "w-hydration", title: "加水率と食感の関係" },
  related: [],
};
const archiveOne: MaintenanceOperation = {
  ...base,
  id: "op-a1",
  kind: "archive",
  startedAt: ago(60 * 26),
  related: [{ wikiId: "w-old", title: "ドライイーストの量（旧）", role: "archived" }],
};
const archiveMany: MaintenanceOperation = {
  ...base,
  id: "op-am",
  kind: "archive",
  startedAt: ago(60 * 50),
  related: [
    { wikiId: "w-a", title: "焼き色の観察メモ", role: "archived" },
    { wikiId: "w-b", title: "オーブン予熱の目安", role: "archived" },
    { wikiId: "w-c", title: "霧吹きのタイミング", role: "archived" },
  ],
};
const restoreVersion: MaintenanceOperation = {
  ...base,
  id: "op-rv",
  kind: "restore_version",
  startedAt: ago(200),
  subject: { wikiId: "w-knead", title: "こね時間と生地温度" },
  related: [],
};
const undo: MaintenanceOperation = {
  ...base,
  id: "op-un",
  kind: "undo",
  startedAt: ago(2),
  subject: { wikiId: "w-ferment", title: "一次発酵の見極め" },
  related: [],
  undoOf: { runId: "maint-run-x", operationId: "op-ma" },
};

/** 日本語 / English の切り替え（ストーリーの文言確認用） */
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

const meta: Meta<typeof MaintenanceOperationRow> = {
  title: "Features/KnowledgeMaintenance/MaintenanceOperationRow",
  component: MaintenanceOperationRow,
  parameters: { layout: "padded" },
  decorators: [(Story) => <LocaleToggle>{Story()}</LocaleToggle>],
  args: { operation: mergeTopics, state: "applied", onUndo: noop, onOpenPage: noop },
};
export default meta;

type Story = StoryObj<typeof MaintenanceOperationRow>;

export const Playground: Story = {};

export const Applied: Story = { name: "取り消せる" };
export const Undone: Story = { name: "取り消し済み", args: { state: "undone" } };
export const UndoPartial: Story = { name: "一部だけ取り消し済み（もう一度試せる）", args: { state: "undo_partial" } };
export const Interrupted: Story = { name: "途中で止まった操作", args: { state: "interrupted" } };
export const Blocked: Story = {
  name: "先に別の操作を取り消す必要がある",
  args: { blockedByName: "一次発酵の見極め" },
};
export const Running: Story = { name: "実行中", args: { state: "running" } };
export const Undoing: Story = { name: "取り消しを実行中", args: { undoing: true } };
export const ViaMcp: Story = {
  name: "外の AI（MCP）から頼まれた操作",
  args: { actorLabel: "MCP (claude-desktop)" },
};

// 種別ごとの見え方（状態は「取り消せる」）
export const Kinds: Story = {
  name: "種別の一覧",
  render: () => (
    <div className="flex flex-col gap-1.5">
      {[mergeTopics, mergeAtoms, regenerate, archiveOne, archiveMany, restoreVersion, undo].map((op) => (
        <MaintenanceOperationRow key={op.id} operation={op} state="applied" onUndo={noop} onOpenPage={noop} />
      ))}
    </div>
  ),
};

// 全状態 × 主な種別
const STATES: MaintenanceOperationState[] = ["applied", "undone", "undo_partial", "interrupted", "running"];
export const AllStates: Story = {
  name: "全状態 × 主な種別",
  render: () => (
    <div className="flex flex-col gap-4">
      {[mergeTopics, mergeAtoms, regenerate, archiveOne, archiveMany, restoreVersion, undo].map((op) => (
        <div key={op.id} className="flex flex-col gap-1.5">
          {STATES.map((s) => (
            <MaintenanceOperationRow key={s} operation={op} state={s} onUndo={noop} onOpenPage={noop} />
          ))}
          <MaintenanceOperationRow
            operation={op}
            state="applied"
            blockedByName="一次発酵の見極め"
            onUndo={noop}
          />
        </div>
      ))}
    </div>
  ),
};
