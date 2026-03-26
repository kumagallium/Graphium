// FormField Molecule — フォーム要素のカタログ

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Label, Input, Textarea, FormField } from "./form-field";
import { Button } from "./button";

const meta: Meta = {
  title: "Molecules/FormField",
  parameters: { layout: "padded" },
};
export default meta;

export const Inputs: StoryObj = {
  name: "入力フィールド",
  render: () => (
    <div className="max-w-md flex flex-col gap-4">
      <section>
        <h3 className="text-sm font-semibold text-foreground mb-3">Input</h3>
        <div className="flex flex-col gap-3">
          <Input placeholder="プレースホルダー" />
          <Input defaultValue="入力済みテキスト" />
          <Input disabled placeholder="無効状態" />
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-foreground mb-3">Textarea</h3>
        <Textarea placeholder="複数行テキスト..." />
      </section>
    </div>
  ),
};

export const WithLabel: StoryObj = {
  name: "ラベル付き",
  render: () => (
    <div className="max-w-md flex flex-col gap-6">
      <FormField label="実験名" htmlFor="name">
        <Input id="name" placeholder="例: Cu粉末アニール実験" />
      </FormField>

      <FormField label="説明" htmlFor="desc">
        <Textarea id="desc" placeholder="実験の概要を入力..." />
      </FormField>

      <FormField label="APIキー" htmlFor="api">
        <Input id="api" type="password" placeholder="sk-..." />
      </FormField>
    </div>
  ),
};

export const FormExample: StoryObj = {
  name: "フォーム例",
  render: () => (
    <div className="max-w-md rounded-xl border border-border bg-card p-6">
      <h2 className="text-sm font-semibold text-foreground mb-4">設定</h2>
      <div className="flex flex-col gap-6">
        <FormField label="表示名" htmlFor="display-name">
          <Input id="display-name" defaultValue="熊谷 将也" />
        </FormField>

        <FormField label="API エンドポイント" htmlFor="endpoint">
          <Input id="endpoint" defaultValue="https://api.example.com" className="font-mono text-xs" />
        </FormField>

        <FormField label="メモ" htmlFor="notes">
          <Textarea id="notes" placeholder="備考があれば..." />
        </FormField>

        <div className="flex justify-end gap-3">
          <Button variant="outline">キャンセル</Button>
          <Button>保存</Button>
        </div>
      </div>
    </div>
  ),
};
