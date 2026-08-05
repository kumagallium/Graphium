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
