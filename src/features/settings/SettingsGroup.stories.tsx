// 「詳しい設定」の束のストーリー。
// 畳んだときに中身が想像できるか、開いたときに元の設定がそのまま入るかを見る。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@ui/button";
import { Input } from "@ui/form-field";
import { SettingsGroup } from "./SettingsGroup";
import { SettingSection } from "./SettingSection";

const meta = {
  title: "Molecules/SettingsGroup",
  component: SettingsGroup,
  parameters: { layout: "padded" },
} satisfies Meta<typeof SettingsGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 既定の畳んだ状態。見出しの下に「中に何があるか」が 1 行出る。 */
export const Collapsed: Story = {
  args: {
    storageKey: "story-collapsed",
    title: "詳しい設定",
    summary: "検索インデックス・サーバー接続",
    children: (
      <>
        <SettingSection
          title="検索インデックス"
          summary="⌘K の検索と AI チャットが使う、この端末の中だけの索引です。"
          details={
            <p>
              ノート本文・ナレッジ・素材のテキスト（画像の OCR、URL の抜粋、PDF）を
              全文検索するための索引です。ノートのデータには書き込みません。
              検索結果がおかしいときは作り直せます。
            </p>
          }
        >
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost">索引を作り直す</Button>
            <span className="text-xs text-muted-foreground">128 件のソース・940 個の断片</span>
          </div>
        </SettingSection>
        <SettingSection
          title="サーバー接続"
          summary="このサーバーは認証なしで使えます。"
          details={<p>本番運用ではトークンの設定をおすすめします。</p>}
        >
          <Input type="password" placeholder="X-Graphium-Token の値" />
        </SettingSection>
      </>
    ),
  },
};

/** 開いた状態。中身は元の設定と同じものがそのまま並ぶ。 */
export const Expanded: Story = {
  args: { ...Collapsed.args, storageKey: "story-expanded", defaultOpen: true },
};
