// ZoomToast — 倍率を変えたときに出る短い表示
// 画面右下の小さなピル。キー・Ctrl + ホイール・メニューで変えたときだけ 2 秒ほど出て、
// 続けて変えると数字が更新されて時間が延びる。100% 以外のときは戻し方を添える。

import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ZoomToast } from "./ZoomToast";

const meta: Meta<typeof ZoomToast> = {
  title: "Molecules/ZoomToast",
  component: ZoomToast,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof ZoomToast>;

function Stage({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[240px] p-4">
      <p className="text-xs text-muted-foreground max-w-md">
        画面右下に出ます。2 秒ほどで消え、操作ボタンは載せません。
      </p>
      {children}
    </div>
  );
}

/** 100% に戻した直後 — 戻し方は添えない */
export const Level100: Story = {
  render: () => (
    <Stage>
      <ZoomToast level={1} visible />
    </Stage>
  ),
};

/** 90% — Windows の狭い画面で縮小したとき */
export const Level90: Story = {
  render: () => (
    <Stage>
      <ZoomToast level={0.9} visible />
    </Stage>
  ),
};

/** 125% — 拡大したとき */
export const Level125: Story = {
  render: () => (
    <Stage>
      <ZoomToast level={1.25} visible />
    </Stage>
  ),
};
