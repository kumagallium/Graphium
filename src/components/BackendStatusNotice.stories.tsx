import type { Meta, StoryObj } from "@storybook/react-vite";
import { BackendStartingNotice, BackendUnavailableNotice } from "./BackendStatusNotice";

// サイドバーのナレッジ節の中に置かれる小片なので、実寸に近い幅で確認する。
const meta: Meta = {
  title: "Components/BackendStatusNotice",
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="w-60 border border-border rounded-lg bg-sidebar-background p-3">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj;

/** デスクトップ版の起動直後。sidecar の到達性がまだ判定できていない数秒間。 */
export const Starting: Story = {
  render: () => <BackendStartingNotice />,
};

/** デスクトップ版でバックエンドが起動しなかったとき。その場から再起動できる。 */
export const Unavailable: Story = {
  render: () => <BackendUnavailableNotice />,
};
