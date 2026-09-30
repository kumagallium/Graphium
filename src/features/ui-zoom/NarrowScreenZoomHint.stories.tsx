// NarrowScreenZoomHint — 画面が狭い環境でだけ、一度だけ出す拡大縮小の案内
// 右下の小さなカード。自動では消えず、× かボタンで閉じる（集中している最中に出ても
// 目に入るように、数秒で消える通知にはしない）。
// 出す条件（幅・高さ・記録・ようこそ後・倍率 100%）は notice.ts が持ち、ここは見た目だけ。
// キーキャップは OS を問わずキーごとに分ける（押すキー自体が「+」「−」で、Ctrl++ のように
// 1 つに畳むと繋ぎの「+」と区別できないため）。mac 引数で ⌘ 表記と Ctrl 表記を見比べられる。

import { useLayoutEffect, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { syncLocale, type Locale } from "@/i18n";
import { NarrowScreenZoomHint } from "./NarrowScreenZoomHint";

const meta: Meta<typeof NarrowScreenZoomHint> = {
  title: "Molecules/NarrowScreenZoomHint",
  component: NarrowScreenZoomHint,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof NarrowScreenZoomHint>;

/** 言語をストーリーごとに固定する（ブラウザのロケールに引きずられない） */
function Stage({ locale, children }: { locale: Locale; children: ReactNode }) {
  useLayoutEffect(() => {
    syncLocale(locale);
  }, [locale]);
  return (
    <div className="min-h-[320px] p-4">
      <p className="text-xs text-muted-foreground max-w-md">
        画面右下に出ます。自動では消えません。
      </p>
      {children}
    </div>
  );
}

const noop = () => {};

/** デスクトップ版（日本語）— 90% にしてみるボタンと、設定への案内つき */
export const DesktopJa: Story = {
  render: () => (
    <Stage locale="ja">
      <NarrowScreenZoomHint isDesktop onDismiss={noop} onApply={noop} />
    </Stage>
  ),
};

/** デスクトップ版（日本語・Windows 表記）— [Ctrl] [−] / [Ctrl] [+] / [Ctrl] [0] とキーごとに分かれる */
export const DesktopWindowsJa: Story = {
  render: () => (
    <Stage locale="ja">
      <NarrowScreenZoomHint isDesktop mac={false} onDismiss={noop} onApply={noop} />
    </Stage>
  ),
};

/** デスクトップ版（日本語・mac 表記）— [⌘] [−] / [⌘] [+] / [⌘] [0] */
export const DesktopMacJa: Story = {
  render: () => (
    <Stage locale="ja">
      <NarrowScreenZoomHint isDesktop mac onDismiss={noop} onApply={noop} />
    </Stage>
  ),
};

/** デスクトップ版（英語） */
export const DesktopEn: Story = {
  render: () => (
    <Stage locale="en">
      <NarrowScreenZoomHint isDesktop onDismiss={noop} onApply={noop} />
    </Stage>
  ),
};

/** ブラウザ版（日本語）— 「ブラウザの拡大縮小です」を添え、ボタンは「閉じる」だけ */
export const BrowserJa: Story = {
  render: () => (
    <Stage locale="ja">
      <NarrowScreenZoomHint isDesktop={false} onDismiss={noop} />
    </Stage>
  ),
};

/** ブラウザ版（英語） */
export const BrowserEn: Story = {
  render: () => (
    <Stage locale="en">
      <NarrowScreenZoomHint isDesktop={false} onDismiss={noop} />
    </Stage>
  ),
};
