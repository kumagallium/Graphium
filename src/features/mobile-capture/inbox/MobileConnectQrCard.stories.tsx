// デスクトップ設定に置く「接続はスマホ側で」案内カードのストーリー。
//
// 接続ボタンが無いことがこのカードの主張（デスクトップは受け取り側で、OAuth は
// 撮る端末の仕事）。QR はローカル生成なので Storybook でもオフラインで出る。
// ダーク/ライトどちらでも読めるよう、QR は白パネル固定で描く。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { MobileConnectQrCard } from "./MobileConnectQrCard";
import "../../../app.css";

/** 設定モーダルのセクション幅（440px 前後）に合わせた枠。 */
function CardHost(props: { url: string }) {
  return (
    <div className="w-[440px] bg-card border border-border rounded-lg p-4">
      <MobileConnectQrCard {...props} />
    </div>
  );
}

const meta: Meta<typeof CardHost> = {
  title: "Mobile Capture / MobileConnectQrCard",
  component: CardHost,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof CardHost>;

/** 配布されている Graphium（デスクトップアプリから見たときの既定）。 */
export const PublicApp: Story = {
  args: { url: "https://kumagallium.github.io/Graphium/app/" },
};

/** セルフホスト（Docker）。web モードでは配信元からそのまま組み立てる。 */
export const SelfHosted: Story = {
  args: { url: "http://192.168.1.24:3001/app/" },
};
