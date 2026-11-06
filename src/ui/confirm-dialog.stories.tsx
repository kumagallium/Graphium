// ConfirmDialog — window.confirm の代わりのアプリ内確認（Atoms）。
// デスクトップ版では window.confirm が素通りするので、確認はすべてこれを await する。
// ボタンを押すと確認が開き、答え（true / false）が下に出る。

import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ConfirmHost, confirmAction, type ConfirmOptions } from "./confirm-dialog";
import { Button } from "./button";

function Demo({ message, options, autoOpen }: { message: string; options?: ConfirmOptions; autoOpen?: boolean }) {
  const [answer, setAnswer] = useState<string>("—");
  const ask = async () => setAnswer(String(await confirmAction(message, options)));
  useEffect(() => {
    // 撮影・目視用に、開いた状態から始める
    if (autoOpen) void ask();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="space-y-3">
      <Button onClick={() => void ask()}>確認を開く</Button>
      <p className="text-xs text-muted-foreground">答え: {answer}</p>
      <ConfirmHost />
    </div>
  );
}

const meta: Meta<typeof Demo> = {
  title: "Atoms/ConfirmDialog",
  component: Demo,
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof Demo>;

/** 通常の確認（青いボタン） */
export const Basic: Story = {
  name: "通常",
  args: { message: "Rebuild the search index? This may take a while.", autoOpen: true },
};

/** 取り返しのつかない操作（赤いボタン・警告の印） */
export const Destructive: Story = {
  name: "取り返しのつかない操作",
  args: {
    message: "Delete this saved point? This cannot be undone.",
    options: { destructive: true, confirmLabel: "Delete" },
    autoOpen: true,
  },
};

/** 日本語の長い文（折り返し） */
export const LongJapanese: Story = {
  name: "長い文（日本語）",
  args: {
    message:
      "このノートを参照しているノートが 3 件あります。ゴミ箱へ移すと、そのノートからのリンクは切れて表示されます。このままゴミ箱へ移しますか？",
    options: { destructive: true },
    autoOpen: true,
  },
};
