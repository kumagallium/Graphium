// 投入口の受け皿単体のストーリー
//
// IntakeModal から切り出した共通部品。「点線の箱・アイコン・2 行・ボタン 2 つ」の
// 見た目が単体でも変わっていないかが合否。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { IntakeReceptacle } from "./IntakeReceptacle";

const meta: Meta<typeof IntakeReceptacle> = {
  title: "Features/Intake/IntakeReceptacle",
  component: IntakeReceptacle,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div style={{ width: 560 }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof IntakeReceptacle>;

const noop = () => {};

/** 既定の見た目 */
export const Default: Story = {
  args: {
    onFilesSelected: noop,
  },
};

/** ウィンドウのどこかでドラッグ中のときの強調表示 */
export const Emphasized: Story = {
  args: {
    emphasized: true,
    onFilesSelected: noop,
  },
};

/** フォルダを選んだ直後、中身をたどり終えて change が来るまでの表示 */
export const Checking: Story = {
  args: {
    checking: true,
    onFilesSelected: noop,
  },
};

/**
 * デスクトップのネイティブ走査中、件数が分かってきた表示。
 * ファイル件数・フォルダ数の行と停止ボタンの両方が出ているかどうかが合否
 */
export const ScanningWithCount: Story = {
  args: {
    scanningCount: 12840,
    scanningFolders: 640,
    onFilesSelected: noop,
  },
};

/**
 * 取り込めない形式（ログ等）を読み飛ばしている間は、その件数も並べて
 * 「止まっていない」ことを伝える
 */
export const ScanningWithSkipped: Story = {
  args: {
    scanningCount: 320,
    scanningFolders: 48,
    scanningSkipped: 18204,
    onFilesSelected: noop,
  },
};

/**
 * デスクトップの走査が上限（500,000 件）で打ち切られ、そのまま入れるか
 * 選び直すかを確かめる表示。一部だけ入ったのを「全部入った」と
 * 誤解させないための一手間なので、件数が読めるかどうかが合否
 */
export const ScanTruncated: Story = {
  args: {
    truncatedCount: 500000,
    onFilesSelected: noop,
  },
};

/** lead を差し替えたケース（例: 素材が空のとき） */
export const WithLead: Story = {
  args: {
    lead: "No notes yet. Start with what you already have.",
    onFilesSelected: noop,
  },
};
