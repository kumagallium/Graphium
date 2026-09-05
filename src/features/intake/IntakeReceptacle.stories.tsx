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

/** lead を差し替えたケース（例: 素材が空のとき） */
export const WithLead: Story = {
  args: {
    lead: "No notes yet. Start with what you already have.",
    onFilesSelected: noop,
  },
};
