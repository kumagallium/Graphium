// スマホ専用の最小設定シートのストーリー。
//
// props 駆動のプレゼンテーション層なので、push の実物なしで全状態
// （未接続 / 接続済み / 未設定 / 同梱 ID 無しビルド）を再現できる。
// 言語セクションは実物の useLocale で動く（Storybook の LocaleProvider デコレータ）。
// transform を持つラッパで fixed シートを 390px のスマホ枠に閉じ込める。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { MobileSettingsSheet, type MobileSettingsSheetProps } from "./MobileSettingsSheet";
import "../../app.css";

const noop = () => {};

const baseProps: MobileSettingsSheetProps = {
  ready: true,
  configured: true,
  connected: false,
  hasBundledId: true,
  clientIdOverride: "",
  onSaveClientId: noop,
  onClearClientId: noop,
  onDisconnect: noop,
  onOpenStoragePicker: noop,
  onClose: noop,
};

/** 390px のスマホ枠。transform で fixed シートを枠内に閉じ込める。 */
function SheetHost(props: MobileSettingsSheetProps) {
  return (
    <div
      className="relative w-[390px] h-[720px] border border-border bg-background overflow-hidden"
      style={{ transform: "translateZ(0)" }}
    >
      <div className="p-3 grid grid-cols-2 gap-2.5 opacity-50">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-card border border-border rounded-lg p-3">
            <div className="h-2 w-3/4 rounded bg-muted mb-2" />
            <div className="h-2 w-1/2 rounded bg-muted" />
          </div>
        ))}
      </div>
      <MobileSettingsSheet {...props} />
    </div>
  );
}

const meta: Meta<typeof SheetHost> = {
  title: "Mobile Capture / MobileSettingsSheet",
  component: SheetHost,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "捕獲履歴ホームのヘッダー ⚙ から開く、スマホ専用の最小設定シート。" +
          "フル設定モーダルはスマホホームからは開かない。中身はスマホで実際に触るものだけ — " +
          "ストレージ（状態 / 接続・変更 → StoragePickerSheet / 切断 / 畳んだ client_id 上書き）・" +
          "言語（設定モーダルと同じ setLocale）・アプリ情報（バージョン）。",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof SheetHost>;

/** 未接続（同梱 client ID あり）。ストレージの主ボタンは [接続]。 */
export const Disconnected: Story = {
  args: { ...baseProps },
};

/** Google Drive 接続済み。[変更] と [切断] が出る。 */
export const Connected: Story = {
  args: { ...baseProps, connected: true },
};

/** 同梱 client ID の無いビルド。自前 ID 必須の注記が常時見える。 */
export const NoBundledClientId: Story = {
  args: { ...baseProps, configured: false, hasBundledId: false },
};

/** 自前 client_id を上書き済み（詳細を開くと値が入っている）。 */
export const WithClientIdOverride: Story = {
  args: {
    ...baseProps,
    connected: true,
    clientIdOverride: "my-own-id.apps.googleusercontent.com",
  },
};
