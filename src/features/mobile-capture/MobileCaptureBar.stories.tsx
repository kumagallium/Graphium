// 画面下固定・捕獲バー（キュー前提ホーム用）のストーリー。
//
// props 駆動なので単体で全構成を再現できる: 6 ボタン（全経路あり）/
// 撮影なし（[書く][URL] のみ）/ 撮影一時無効。390px のモバイル幅の枠で
// 6 個並べても潰れないこと（アイコン + 短ラベルの縦積み）を見る。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { MobileCaptureBar, type MobileCaptureBarProps } from "./MobileCaptureBar";
import "../../app.css";

const noop = () => {};

/** モバイルホームの画面下相当の枠（バーは下端に固定される想定）。 */
function BarHost(props: MobileCaptureBarProps) {
  return (
    <div className="w-[390px] bg-background border border-border flex flex-col">
      <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">
        （タイムライン）
      </div>
      <MobileCaptureBar {...props} />
    </div>
  );
}

const meta: Meta<typeof BarHost> = {
  title: "Mobile Capture / MobileCaptureBar",
  component: BarHost,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "キュー前提ホーム（モバイル連携フラグ ON）の画面下固定・捕獲バー。" +
          "[書く][URL][写真][動画][音声][ライブラリ] の 6 ボタンで、捕獲物は全部" +
          "送信キュー行き（行き先の判断は親の責務）。[書く] は常時、[URL] は経路が" +
          "あるときだけ、撮影 4 ボタンは showMediaButtons の間だけ出る。",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof BarHost>;

/** 全経路あり: 6 ボタンが 1 段に並ぶ（390px 幅で潰れない）。 */
export const AllButtons: Story = {
  args: {
    onComposeMemo: noop,
    onAddUrl: noop,
    showMediaButtons: true,
    onAddFiles: noop,
  },
};

/** 撮影経路なし（キュー不可 + ローカル保存なし）: [書く][URL] だけの退避構成。 */
export const ComposeOnly: Story = {
  args: {
    onComposeMemo: noop,
    onAddUrl: noop,
    showMediaButtons: false,
    onAddFiles: noop,
  },
};

/** ローカル保存フォールバックのアップロード中など、撮影だけ一時無効。 */
export const MediaDisabled: Story = {
  args: {
    onComposeMemo: noop,
    onAddUrl: noop,
    showMediaButtons: true,
    mediaDisabled: true,
    onAddFiles: noop,
  },
};
