// MemoToolbarButton — 書式ツールバーの「メモ」ボタン
//
// 文字を選んだとき（選んだ文にメモを書く）と、画像・動画・PDF を選んだとき
// （その素材のメモの小窓を開く）の 2 か所に並ぶ。周囲の BlockNote 標準ボタンと
// 同じ 36px 角・rounded-md で揃える。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Bot, Bold, Italic, PanelRightOpen } from "lucide-react";
import { MemoToolbarButton } from "./MemoToolbarButton";
import "../../app.css";

/** 周囲の標準ボタンと並べて、寸法が揃っているかを見るための枠 */
function ToolbarFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-1 shadow-sm">
      {[Bold, Italic].map((Icon, i) => (
        <button
          key={i}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-black/5"
        >
          <Icon size={18} />
        </button>
      ))}
      {children}
      <button className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-violet-100 text-violet-500">
        <Bot size={18} />
      </button>
    </div>
  );
}

const meta: Meta<typeof MemoToolbarButton> = {
  title: "Molecules/MemoToolbarButton",
  component: MemoToolbarButton,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof MemoToolbarButton>;

/** 文字を選んだとき: 太字・斜体の右、AI ボタンの手前に並ぶ。ホバーでツールチップ */
export const OnTextSelection: Story = {
  render: () => (
    <div className="p-6 space-y-3">
      <p className="text-xs text-muted-foreground max-w-md">
        標準ボタン（太字・斜体）と AI ボタンの間に並べています。36px 角・rounded-md で揃っているか、
        ホバーでツールチップが出るかを確認します。
      </p>
      <ToolbarFrame>
        <MemoToolbarButton
          name="選んだ文にメモ"
          usage="選んだ文に付けたメモを書きます"
          onOpen={() => {}}
        />
      </ToolbarFrame>
    </div>
  ),
};

/** 画像を選んだとき: 「横のパネルで見る」ボタンの隣に並ぶ */
export const OnImageSelection: Story = {
  render: () => (
    <div className="p-6 space-y-3">
      <p className="text-xs text-muted-foreground max-w-md">
        画像を選んだときのツールバー。「横のパネルで大きく見る」の隣に並びます。
      </p>
      <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-1 shadow-sm">
        <button className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-black/5">
          <PanelRightOpen size={18} />
        </button>
        <MemoToolbarButton
          name="この素材にメモ"
          usage="この素材のメモを読んだり、その場で書いたりできます"
          onOpen={() => {}}
        />
      </div>
    </div>
  ),
};
