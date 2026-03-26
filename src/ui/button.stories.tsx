// Button Atom — 全バリアント・サイズのカタログ

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Settings, Trash2, Plus, Save } from "lucide-react";
import { Button } from "./button";

const meta: Meta<typeof Button> = {
  title: "Atoms/Button",
  component: Button,
  parameters: { layout: "padded" },
  argTypes: {
    variant: {
      control: "select",
      options: ["primary", "secondary", "outline", "ghost", "destructive"],
    },
    size: {
      control: "select",
      options: ["default", "sm", "lg", "icon"],
    },
    disabled: { control: "boolean" },
  },
};
export default meta;

type Story = StoryObj<typeof Button>;

// インタラクティブ playground
export const Playground: Story = {
  args: {
    children: "ボタン",
    variant: "primary",
    size: "default",
  },
};

// 全バリアント一覧
export const AllVariants: Story = {
  name: "全バリアント",
  render: () => (
    <div className="flex flex-col gap-6">
      <section>
        <h3 className="text-sm font-semibold text-foreground mb-3">バリアント</h3>
        <div className="flex flex-wrap gap-3">
          <Button variant="primary">プライマリー</Button>
          <Button variant="secondary">セカンダリー</Button>
          <Button variant="outline">アウトライン</Button>
          <Button variant="ghost">ゴースト</Button>
          <Button variant="destructive">削除</Button>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-foreground mb-3">サイズ</h3>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="default">Default</Button>
          <Button size="lg">Large</Button>
          <Button size="icon"><Settings /></Button>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-foreground mb-3">アイコン付き</h3>
        <div className="flex flex-wrap gap-3">
          <Button variant="primary"><Plus /> 新規作成</Button>
          <Button variant="secondary"><Save /> 保存</Button>
          <Button variant="destructive"><Trash2 /> 削除</Button>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-foreground mb-3">無効状態</h3>
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" disabled>プライマリー</Button>
          <Button variant="outline" disabled>アウトライン</Button>
          <Button variant="ghost" disabled>ゴースト</Button>
        </div>
      </section>
    </div>
  ),
};
