// 全画面ドロップ案内のストーリー
//
// 背景の上に薄い点線の枠と中央カードが重なって見えるかが合否。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { IntakeDropOverlay } from "./IntakeDropOverlay";

const meta: Meta<typeof IntakeDropOverlay> = {
  title: "Features/Intake/IntakeDropOverlay",
  component: IntakeDropOverlay,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof IntakeDropOverlay>;

/** 表示中。背景のダミー文章との重なりが分かるようにしている */
export const Visible: Story = {
  args: { visible: true },
  render: (args) => (
    <div style={{ padding: 24 }}>
      <h1>ノート一覧</h1>
      <p>
        ここは背景のダミー文章です。ウィンドウのどこかでファイルをドラッグしている間、
        この上に全画面のドロップ案内が重なって表示されます。
      </p>
      <IntakeDropOverlay {...args} />
    </div>
  ),
};
