// モバイル [音声] の録音ボトムシートのストーリー。
//
// マイクを握るのはコンテナ（AudioRecorderSheet）で、ここに出すのは props 駆動の
// プレゼンテーション層（AudioRecorderSheetView）— 権限ダイアログを出さずに
// 全状態を並べて見られる。390px 幅のモバイル枠に重ねて確認する。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { AudioRecorderSheetView, type AudioRecorderSheetViewProps } from "./AudioRecorderSheet";
import "../../app.css";

const noop = () => {};

/** モバイル画面相当の枠（シートは下端に貼り付く）。 */
function SheetHost(props: AudioRecorderSheetViewProps) {
  return (
    <div className="relative w-[390px] h-[560px] bg-background border border-border overflow-hidden">
      <div className="p-4 text-xs text-muted-foreground">（捕獲履歴ホーム）</div>
      <AudioRecorderSheetView {...props} />
    </div>
  );
}

const meta: Meta<typeof SheetHost> = {
  title: "Mobile Capture / AudioRecorderSheet",
  component: SheetHost,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "捕獲バーの [音声] の行き先。iOS では `capture` 属性付きの file input が" +
          "ビデオ撮影 UI を開いてしまうため、その場で録るにはアプリ内録音しかない。" +
          "録れた音声はプレビューしてから捕獲でき、そのまま送信キューへ流れる。",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof SheetHost>;

const base: AudioRecorderSheetViewProps = {
  status: "idle",
  elapsedMs: 0,
  onStart: noop,
  onStop: noop,
  onRetake: noop,
  onCapture: noop,
  onClose: noop,
};

/** 開いた直後。主操作は録音開始の 1 つだけ。 */
export const Idle: Story = { args: { ...base } };

/** 権限ダイアログの応答待ち（ボタンは押せない）。 */
export const Requesting: Story = { args: { ...base, status: "requesting" } };

/** 録音中。時間が赤で伸び、ボタンは停止に変わる。 */
export const Recording: Story = { args: { ...base, status: "recording", elapsedMs: 65_000 } };

/** 停止直後の書き出し中（長い録音では一瞬見える）。 */
export const Processing: Story = { args: { ...base, status: "processing", elapsedMs: 65_000 } };

/** 録れた音声。聴き直してから [捕獲する]、気に入らなければ [録り直す]。 */
export const Recorded: Story = {
  args: { ...base, status: "recorded", elapsedMs: 12_000, previewUrl: "" },
};

/** 10 分の上限に当たって自動停止した場合（理由を添える）。 */
export const LimitReached: Story = {
  args: { ...base, status: "recorded", elapsedMs: 600_000, previewUrl: "", limitReached: true },
};

/** マイクがブロックされている（ブラウザ設定へ案内する）。 */
export const PermissionDenied: Story = {
  args: { ...base, status: "error", errorKind: "denied" },
};

/** マイクが見つからない端末。 */
export const NoMicrophone: Story = {
  args: { ...base, status: "error", errorKind: "noDevice" },
};
