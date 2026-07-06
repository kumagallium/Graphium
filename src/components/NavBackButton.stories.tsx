import type { Meta, StoryObj } from "@storybook/react-vite";
import { NavBackButton } from "./NavBackButton";

const meta: Meta<typeof NavBackButton> = {
  title: "Components/NavBackButton",
  component: NavBackButton,
  parameters: { layout: "centered" },
  args: {
    onBack: () => console.log("back"),
    canGoBack: true,
  },
};

export default meta;
type Story = StoryObj<typeof NavBackButton>;

// 戻れる状態: アイコンボタンを表示する
export const CanGoBack: Story = {};

// 戻れない状態: 消さず、灰色の disabled ボタンとして残す（位置が一定）
export const CannotGoBack: Story = {
  args: { canGoBack: false },
};

// ヘッダーに置いたときの見え方（パンくず／タイトルの左に添える想定）
export const InHeaderContext: Story = {
  render: (args) => (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <NavBackButton {...args} />
      <nav className="flex items-center gap-1 text-xs text-muted-foreground">
        <span>ホーム</span>
        <span className="opacity-50">›</span>
        <span className="font-medium text-foreground">ノートB</span>
      </nav>
    </div>
  ),
};
