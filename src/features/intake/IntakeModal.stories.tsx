// 投入口モーダルのストーリー
//
// idle（受け皿） / running（進行中） / done（復元レポート）の 3 状態を並べる。
// 各状態の合否はストーリー先頭のコメントを参照。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { IntakeModal } from "./IntakeModal";

const meta: Meta<typeof IntakeModal> = {
  title: "Features/Intake/IntakeModal",
  component: IntakeModal,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof IntakeModal>;

const noop = () => {};

/** 受け皿。「規則の 1 文が読める」「ボタン 2 つの主従が分かる」が合否 */
export const Idle: Story = {
  args: {
    open: true,
    state: { kind: "idle" },
    onClose: noop,
    onFilesSelected: noop,
  },
};

/** dragActive: true。受け皿が強調される */
export const IdleDragging: Story = {
  args: {
    open: true,
    state: { kind: "idle" },
    dragActive: true,
    onClose: noop,
    onFilesSelected: noop,
  },
};

/** 進行中。進捗バーとファイル名の表示が既存の importProgress と揃っているかが合否 */
export const Running: Story = {
  args: {
    open: true,
    state: {
      kind: "running",
      done: 12,
      total: 40,
      current: "2023-05-14 焼成テスト.md",
      failed: [],
    },
    onClose: noop,
    onFilesSelected: noop,
  },
};

/** 進行中 + 失敗あり。失敗件数の表示位置が合否 */
export const RunningWithFailures: Story = {
  args: {
    open: true,
    state: {
      kind: "running",
      done: 30,
      total: 40,
      current: "2023-05-14 焼成テスト.md",
      failed: ["broken.md", "old-notes.md"],
    },
    onClose: noop,
    onFilesSelected: noop,
  },
};

/** 復元レポート。数字の一覧と「次の動作」の並びが合否 */
export const Done: Story = {
  args: {
    open: true,
    state: {
      kind: "done",
      notes: 38,
      materials: 17,
      linksResolved: 120,
      linksUnresolved: 0,
      failed: [],
      aiAvailable: true,
    },
    onClose: noop,
    onFilesSelected: noop,
    onSearch: noop,
    onShowGraph: noop,
    onAskAi: noop,
  },
};

/** 復元レポート + 未解決リンク・失敗あり。注意書きが2つとも出るかが合否 */
export const DoneWithIssues: Story = {
  args: {
    open: true,
    state: {
      kind: "done",
      notes: 36,
      materials: 17,
      linksResolved: 117,
      linksUnresolved: 3,
      failed: ["broken.md", "old-notes.md"],
      aiAvailable: true,
    },
    onClose: noop,
    onFilesSelected: noop,
    onSearch: noop,
    onShowGraph: noop,
    onAskAi: noop,
  },
};

/** 復元レポート・AI 未設定。「AI に聞く」の代わりに「AI を設定する」が出るかが合否 */
export const DoneNoAi: Story = {
  args: {
    open: true,
    state: {
      kind: "done",
      notes: 38,
      materials: 17,
      linksResolved: 120,
      linksUnresolved: 0,
      failed: [],
      aiAvailable: false,
    },
    onClose: noop,
    onFilesSelected: noop,
    onSearch: noop,
    onShowGraph: noop,
    onSetupAi: noop,
  },
};
