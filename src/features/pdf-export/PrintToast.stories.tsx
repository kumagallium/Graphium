// PrintToast — 印刷の準備が長引いたときだけ出るトースト
// 画面右下に fixed 表示される小さなピル。印刷パネルが開いた瞬間に消えるので、
// 実際の画面では画像の多いノートでしか目にしない（操作は持たせない）。

import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PrintToast } from "./PrintToast";

const meta: Meta<typeof PrintToast> = {
  title: "Molecules/PrintToast",
  component: PrintToast,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof PrintToast>;

/** 出したり消したりして見え方を確かめるためのラッパー */
function ToastPlayground({ initial }: { initial: boolean }) {
  const [visible, setVisible] = useState(initial);
  return (
    <div className="min-h-[320px] p-4 space-y-2">
      <p className="text-xs text-muted-foreground max-w-md">
        印刷を始めてから 300ms 経っても印刷パネルに届かないときだけ出ます。短いノートでは
        一度も出ないまま印刷パネルが開きます。
      </p>
      <button className="text-xs underline text-primary" onClick={() => setVisible((v) => !v)}>
        {visible ? "隠す" : "出す"}
      </button>
      <PrintToast visible={visible} />
    </div>
  );
}

/** 準備中 — 画像の読み込みや PROV グラフの描画を待っている間 */
export const Preparing: Story = {
  render: () => <ToastPlayground initial={true} />,
};

/** 出ていない状態 — 準備がすぐ終わったノートではこのまま印刷パネルに移る */
export const Hidden: Story = {
  render: () => <ToastPlayground initial={false} />,
};
