// ZoomSetting — 設定「表示・言語」の「画面の大きさ」
// デスクトップは倍率を選ぶ select（選んだらすぐ反映）、ブラウザは案内文だけ。
// SettingsModal のストーリーは Storybook では常にブラウザ版になるので、
// デスクトップの見た目はこちらで確認する。

import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ZoomSetting } from "./ZoomSetting";

const LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5];

const meta: Meta<typeof ZoomSetting> = {
  title: "Molecules/ZoomSetting",
  component: ZoomSetting,
  decorators: [
    (Story) => (
      <div className="max-w-md p-4">
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof ZoomSetting>;

function DesktopDemo({ showWheelHint }: { showWheelHint: boolean }) {
  const [level, setLevel] = useState(0.9);
  return (
    <ZoomSetting
      isDesktop
      level={level}
      levels={LEVELS}
      onChange={setLevel}
      showWheelHint={showWheelHint}
    />
  );
}

/** デスクトップ（Windows / Linux）— 「くわしく」に Ctrl + ホイールの説明が入る */
export const Desktop: Story = {
  render: () => <DesktopDemo showWheelHint />,
};

/** デスクトップ（mac）— ホイールの説明は書かない */
export const DesktopMac: Story = {
  render: () => <DesktopDemo showWheelHint={false} />,
};

/** デスクトップ — 倍率がまだ取れていない間（select は押せない） */
export const DesktopLoading: Story = {
  render: () => (
    <ZoomSetting isDesktop level={null} levels={[]} onChange={() => {}} />
  ),
};

/** ブラウザ — コントロールは出さず、ブラウザの拡大縮小を案内する */
export const Browser: Story = {
  render: () => (
    <ZoomSetting isDesktop={false} level={null} levels={[]} onChange={() => {}} />
  ),
};
