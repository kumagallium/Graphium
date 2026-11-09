// SnapshotRow — 版タイムラインの 1 行のカタログ

import type { Meta, StoryObj } from "@storybook/react-vite";
import { SnapshotRow, type SnapshotRowLabels } from "./SnapshotRow";

const labels: SnapshotRowLabels = {
  unnamed: "（未命名）",
  open: "開く",
  derive: "ここから派生",
  restore: "この版に戻す",
  rename: "名前を変更",
  delete: "削除",
  aiRewriteBadge: "AI書き換え前",
  frameBackfillBadge: "構造を補完する前",
  seal: "証拠として固定する",
  sealedBadge: "固定済み",
  verifySeal: "固定した内容を確かめる",
  exportSeal: "証拠を書き出す",
  provenBefore: "{time} より前にあったことを証明",
  proofWaiting: "確定待ち {count} 件",
  proofNone: "時刻の証明はまだありません",
  sealProblem: "固定したファイルが見つからないか、中身が合いません",
};

const noop = () => {};

const meta: Meta<typeof SnapshotRow> = {
  title: "Features/VersionSnapshots/SnapshotRow",
  component: SnapshotRow,
  parameters: { layout: "padded" },
  args: {
    version: 3,
    label: "予算増額版",
    savedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    labels,
    onOpen: noop,
    onDerive: noop,
    onRename: noop,
    onDelete: noop,
  },
};
export default meta;

type Story = StoryObj<typeof SnapshotRow>;

export const Playground: Story = {};

export const Named: Story = {
  name: "命名済み",
  args: { version: 3, label: "予算増額版" },
};

export const Unnamed: Story = {
  name: "未命名",
  args: { version: 1, label: undefined, savedAt: new Date(Date.now() - 3 * 86400_000).toISOString() },
};

export const Selected: Story = {
  name: "選択中（サイドピークで開いている）",
  args: { version: 2, label: "初期案", selected: true },
};

// スキルの履歴パネル: 派生の代わりに「この版に戻す」が出る
export const SkillRow: Story = {
  name: "スキル（戻すあり・派生なし）",
  args: {
    version: 2,
    label: "強い語彙の禁止を追加",
    onDerive: undefined,
    onRestore: noop,
  },
};

// AI がナレッジページを書き換える直前に自動で残した版（人が編集した来歴があるページのみ）
export const AiRewrite: Story = {
  name: "AI書き換え前（自動）",
  args: { version: 4, label: undefined, origin: "ai_rewrite" },
};

// 構造の補完・理由の記入で wikiMeta だけを書き換える直前に自動で残した版
export const FrameBackfill: Story = {
  name: "構造を補完する前（自動）",
  args: { version: 5, label: undefined, origin: "frame_backfill" },
};

export const Timeline: Story = {
  name: "タイムライン（複数版）",
  render: () => (
    <div className="flex max-w-xs flex-col gap-1.5">
      <SnapshotRow
        version={3}
        label="予算増額版"
        savedAt={new Date(Date.now() - 2 * 3600_000).toISOString()}
        labels={labels}
        onOpen={noop}
        onDerive={noop}
        onRename={noop}
        onDelete={noop}
      />
      <SnapshotRow
        version={2}
        label="初期案"
        selected
        savedAt={new Date(Date.now() - 3 * 86400_000).toISOString()}
        labels={labels}
        onOpen={noop}
        onDerive={noop}
        onRename={noop}
        onDelete={noop}
      />
      <SnapshotRow
        version={1}
        savedAt={new Date(Date.now() - 7 * 86400_000).toISOString()}
        labels={labels}
        onOpen={noop}
        onDerive={noop}
        onRename={noop}
        onDelete={noop}
      />
    </div>
  ),
};

// ── 封印（電子実験ノートとしての証拠化）──

export const Sealable: Story = {
  name: "封印できる版（人が残した版）",
  args: { version: 4, label: "一次発酵 60 分で確定", onSeal: noop },
};

export const SealedConfirmed: Story = {
  name: "封印済み・時刻の証明あり＋確定待ち",
  args: {
    version: 4,
    label: "一次発酵 60 分で確定",
    seal: { provenAt: new Date(Date.now() - 2 * 3600_000).toISOString(), pending: 1 },
    onVerifySeal: noop,
    onExportSeal: noop,
  },
};

export const SealedAllConfirmed: Story = {
  name: "封印済み・証明がすべて確定",
  args: {
    version: 4,
    label: "一次発酵 60 分で確定",
    seal: { provenAt: new Date(Date.now() - 3 * 86400_000).toISOString(), pending: 0 },
    onVerifySeal: noop,
    onExportSeal: noop,
  },
};

export const SealedOffline: Story = {
  name: "封印済み・証明はまだ（オフラインだった）",
  args: {
    version: 4,
    label: "一次発酵 60 分で確定",
    seal: { pending: 2 },
    onVerifySeal: noop,
    onExportSeal: noop,
  },
};

export const SealedProblem: Story = {
  name: "封印済み・封印ファイルに問題",
  args: {
    version: 4,
    label: "一次発酵 60 分で確定",
    seal: { pending: 0, problem: true },
    onVerifySeal: noop,
    onExportSeal: noop,
  },
};

// マニュアル用（英語・パン作りの世界観）。scripts/manual-screenshots-seal.mjs が撮る
const enLabels: SnapshotRowLabels = {
  unnamed: "(Unnamed)",
  open: "Open",
  derive: "Duplicate as new note",
  restore: "Restore this point",
  rename: "Rename",
  delete: "Delete",
  aiRewriteBadge: "Before AI rewrite",
  frameBackfillBadge: "Before rebuild",
  seal: "Seal as evidence",
  sealedBadge: "Sealed",
  verifySeal: "Check the seal",
  exportSeal: "Export evidence",
  provenBefore: "Proven to exist before {time}",
  proofWaiting: "{count} pending",
  proofNone: "No timestamp yet",
  sealProblem: "The seal file is missing or does not match",
};

export const ManualEnglish: Story = {
  name: "Manual (English, bread world)",
  render: () => (
    <div data-manual-shot style={{ width: 340 }} className="space-y-1.5 bg-background p-3">
      <SnapshotRow
        version={2}
        label="First rise 60 min"
        savedAt="2026-11-05T07:20:00.000Z"
        seal={{ provenAt: "2026-11-05T07:22:20.000Z", pending: 1 }}
        onOpen={noop}
        onDerive={noop}
        onVerifySeal={noop}
        onExportSeal={noop}
        labels={enLabels}
      />
      <SnapshotRow
        version={1}
        label="Starter test"
        savedAt="2026-11-04T09:10:00.000Z"
        onOpen={noop}
        onDerive={noop}
        onRename={noop}
        onDelete={noop}
        onSeal={noop}
        labels={enLabels}
      />
    </div>
  ),
};
