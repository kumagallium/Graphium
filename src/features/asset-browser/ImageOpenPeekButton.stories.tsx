// ImageOpenPeekButton — 画像を選んだときのツールバーに出る「サイドピークで開く」ボタン
//
// 画像ブロックを選択すると出る BlockNote のツールバーの、OCR ボタンの直後に並ぶ。
// 押すと素材のサイドピークで大きく表示する（全画面表示・素材の情報もそこから）。
// 画像のダブルクリックでも同じところが開く。
//
// サイズは周囲の BlockNote 標準ボタンに合わせて 36px 角・rounded-md。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScanText } from "lucide-react";
import { ImageOpenPeekButton } from "./ImageOpenPeekButton";

/** 周囲の標準ボタン・OCR ボタンと並べて、寸法が揃っているかを見るための枠 */
function ToolbarFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-1 shadow-sm">
      {/* 標準ボタン相当のダミー（36px 角） */}
      {["A", "¶", "⋯"].map((label) => (
        <button
          key={label}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-black/5"
        >
          {label}
        </button>
      ))}
      {/* OCR ボタン相当のダミー（本物の直後に並ぶ） */}
      <button className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-black/5">
        <ScanText size={18} />
      </button>
      {children}
    </div>
  );
}

const meta: Meta<typeof ImageOpenPeekButton> = {
  title: "Molecules/ImageOpenPeekButton",
  component: ImageOpenPeekButton,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof ImageOpenPeekButton>;

/**
 * ツールバーに並んだ状態 — ダミーの標準ボタン・OCR ボタンと寸法が揃っているかを見る。
 * ホバーするとツールチップ（横に大きく表示・全画面表示や素材の情報もここから・
 * ダブルクリックでも開ける）が出る。
 */
export const InToolbar: Story = {
  render: () => (
    <div className="p-6 space-y-3">
      <p className="text-xs text-muted-foreground max-w-md">
        ダミーの標準ボタン（A / ¶ / ⋯）と OCR ボタンの右に並べています。
        36px 角・rounded-md で揃っているか、ホバーでツールチップが出るかを確認します。
      </p>
      <ToolbarFrame>
        <ImageOpenPeekButton onOpen={() => {}} />
      </ToolbarFrame>
    </div>
  ),
};
