// Badge Atom — 全バリアントのカタログ

import type { Meta, StoryObj } from "@storybook/react-vite";
import { CheckCircle, AlertTriangle, Info, XCircle } from "lucide-react";
import { Badge } from "./badge";

const meta: Meta<typeof Badge> = {
  title: "Atoms/Badge",
  component: Badge,
  parameters: { layout: "padded" },
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "secondary", "outline", "success", "error", "info", "warning"],
    },
  },
};
export default meta;

type Story = StoryObj<typeof Badge>;

export const Playground: Story = {
  args: {
    children: "バッジ",
    variant: "default",
  },
};

export const AllVariants: Story = {
  name: "全バリアント",
  render: () => (
    <div className="flex flex-col gap-6">
      <section>
        <h3 className="text-sm font-semibold text-foreground mb-3">基本</h3>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="default">デフォルト</Badge>
          <Badge variant="secondary">セカンダリー</Badge>
          <Badge variant="outline">アウトライン</Badge>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-foreground mb-3">セマンティック</h3>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="success"><CheckCircle /> 成功</Badge>
          <Badge variant="error"><XCircle /> エラー</Badge>
          <Badge variant="info"><Info /> 情報</Badge>
          <Badge variant="warning"><AlertTriangle /> 警告</Badge>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-foreground mb-3">PROV-DM ラベル（カスタムカラー）</h3>
        <p className="text-xs text-muted-foreground mb-2">
          ProvLabel コンポーネントで実装。動的カラーのため Badge のバリアントではなく専用コンポーネントを使用。
        </p>
        <div className="flex flex-wrap gap-1.5">
          {[
            { name: "手順", color: "#5b8fb9" },
            { name: "使用したもの", color: "#4B7A52" },
            { name: "属性", color: "#c08b3e" },
            { name: "試料", color: "#8b7ab5" },
            { name: "結果", color: "#c26356" },
          ].map((l) => (
            <span
              key={l.name}
              className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
              style={{
                backgroundColor: l.color + "18",
                color: l.color,
                border: `1px solid ${l.color}38`,
              }}
            >
              [{l.name}]
            </span>
          ))}
        </div>
      </section>
    </div>
  ),
};
