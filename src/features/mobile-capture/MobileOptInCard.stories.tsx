// 従来ホームの実験オプトインカードのストーリー。
//
// 従来ホーム（実験フラグ OFF）のタイムライン上部に置く控えめなカード。
// AiUpgradeNotice の card 様式（rounded-lg + bg-muted/40）を踏襲。
// × は付けない — OFF 中は最小設定シート（⚙）も無く、消すと再表示の入口が
// 無くなるため（常設でも圧が出ないよう小さく保つ、が設計判断）。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { MobileOptInCard } from "./MobileOptInCard";
import "../../app.css";

/** 従来ホーム相当の枠: 検索バー下・タイムライン上部にカードが乗る見え方。 */
function CardHost() {
  return (
    <div className="w-[390px] bg-background border border-border p-3 flex flex-col gap-3">
      <MobileOptInCard onTry={() => {}} />
      <div className="grid grid-cols-2 gap-2.5 opacity-50">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-card border border-border rounded-lg p-3">
            <div className="h-2 w-3/4 rounded bg-muted mb-2" />
            <div className="h-2 w-1/2 rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}

const meta: Meta<typeof CardHost> = {
  title: "Mobile Capture / MobileOptInCard",
  component: CardHost,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "従来ホーム（実験フラグ OFF）のタイムライン上部に出す実験オプトインカード。" +
          "スマホからは設定モーダルの「モバイル連携」トグルを消したため、スマホで実験に入る" +
          "唯一の入口: [試す] → ストレージ選択（StoragePickerSheet）→ 接続成功でフラグが立ち、" +
          "ホームがキュー前提に切り替わる。× は付けない（OFF 中は再表示の入口が無くなるため、" +
          "永続 dismiss ではなく控えめな常設にする判断）。",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof CardHost>;

/** 従来ホームのタイムライン上部に乗った状態。 */
export const OnLegacyHome: Story = {};
