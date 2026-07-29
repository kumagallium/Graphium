// ストレージ選択ボトムシートのストーリー。
//
// props 駆動のプレゼンテーション層なので、接続の実物（gsi / pusher）なしで全状態
// （既定 / 準備中 / 接続中 / 失敗）を再現できる。
// transform を持つラッパは fixed の containing block になるため、fixed inset-0 の
// シートを 390px のスマホ枠内に閉じ込めて見せる（Storybook 専用のトリック）。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { StoragePickerSheet, type StoragePickerSheetProps } from "./StoragePickerSheet";
import "../../app.css";

const noop = () => {};

const baseProps: StoragePickerSheetProps = {
  googleReady: true,
  connecting: false,
  connectError: null,
  onSelectGoogle: noop,
  onClose: noop,
};

/** 390px のスマホ枠。transform で fixed シートを枠内に閉じ込める。 */
function SheetHost(props: StoragePickerSheetProps) {
  return (
    <div
      className="relative w-[390px] h-[640px] border border-border bg-background overflow-hidden"
      style={{ transform: "translateZ(0)" }}
    >
      {/* 背後のホームのプレースホルダ */}
      <div className="p-3 grid grid-cols-2 gap-2.5 opacity-50">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-card border border-border rounded-lg p-3">
            <div className="h-2 w-3/4 rounded bg-muted mb-2" />
            <div className="h-2 w-1/2 rounded bg-muted" />
          </div>
        ))}
      </div>
      <StoragePickerSheet {...props} />
    </div>
  );
}

const meta: Meta<typeof SheetHost> = {
  title: "Mobile Capture / StoragePickerSheet",
  component: SheetHost,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "スマホの「ストレージに接続」の行き先となるストレージ選択シート。Google Drive（利用可）/ " +
          "OneDrive（準備中・P1.5 で活性化する枠）を並べる。並ぶのは接続するストレージだけ — " +
          "送り方のバリエーションは置かない。開く入口は 2 つ — 捕獲履歴ホームの未接続時主ボタンと、" +
          "最小設定シートの [接続/変更]。onSelectGoogle は " +
          "click から同期的に呼ばれる（GIS の user activation 契約）。",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof SheetHost>;

/** 既定: Google 利用可 / OneDrive 準備中。 */
export const Default: Story = {
  args: { ...baseProps },
};

/** push モジュールの準備中（prepare 未完了）。Google 行は押せない。 */
export const Preparing: Story = {
  args: { ...baseProps, googleReady: false },
};

/** Google の接続ポップアップ進行中。 */
export const Connecting: Story = {
  args: { ...baseProps, connecting: true },
};

/** 接続失敗（ポップアップを閉じた・権限拒否など）。 */
export const ConnectFailed: Story = {
  args: { ...baseProps, connectError: "Popup closed by user" },
};
