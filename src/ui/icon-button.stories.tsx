// IconButton Atom — アイコンボタンのカタログ

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Settings, X, Plus, Copy, MoreHorizontal, Trash2, Pencil } from "lucide-react";
import { IconButton } from "./icon-button";

const meta: Meta<typeof IconButton> = {
  title: "Atoms/IconButton",
  component: IconButton,
  parameters: { layout: "padded" },
  argTypes: {
    size: {
      control: "select",
      options: ["sm", "md", "lg"],
    },
    disabled: { control: "boolean" },
  },
};
export default meta;

type Story = StoryObj<typeof IconButton>;

export const Playground: Story = {
  args: {
    "aria-label": "設定",
    size: "md",
    children: <Settings />,
  },
};

export const AllVariants: Story = {
  name: "全バリアント",
  render: () => (
    <div className="flex flex-col gap-6">
      <section>
        <h3 className="text-sm font-semibold text-foreground mb-3">サイズ</h3>
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-center gap-1">
            <IconButton size="sm" aria-label="Small"><Settings /></IconButton>
            <span className="text-xs text-muted-foreground">sm</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <IconButton size="md" aria-label="Medium"><Settings /></IconButton>
            <span className="text-xs text-muted-foreground">md</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <IconButton size="lg" aria-label="Large"><Settings /></IconButton>
            <span className="text-xs text-muted-foreground">lg</span>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-foreground mb-3">使用例</h3>
        <div className="flex items-center gap-2">
          <IconButton aria-label="追加"><Plus /></IconButton>
          <IconButton aria-label="編集"><Pencil /></IconButton>
          <IconButton aria-label="コピー"><Copy /></IconButton>
          <IconButton aria-label="メニュー"><MoreHorizontal /></IconButton>
          <IconButton aria-label="削除" className="hover:text-destructive"><Trash2 /></IconButton>
          <IconButton aria-label="閉じる"><X /></IconButton>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-foreground mb-3">ツールバー風</h3>
        <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-1">
          <IconButton size="sm" aria-label="追加"><Plus /></IconButton>
          <IconButton size="sm" aria-label="編集"><Pencil /></IconButton>
          <IconButton size="sm" aria-label="コピー"><Copy /></IconButton>
          <div className="w-px h-4 bg-border mx-1" />
          <IconButton size="sm" aria-label="削除" className="hover:text-destructive"><Trash2 /></IconButton>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-foreground mb-3">無効状態</h3>
        <div className="flex items-center gap-2">
          <IconButton aria-label="設定" disabled><Settings /></IconButton>
          <IconButton aria-label="削除" disabled><Trash2 /></IconButton>
        </div>
      </section>
    </div>
  ),
};
