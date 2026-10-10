// WikiListMenu のストーリー。メニューを開いた状態（項目の並び・アイコン・無効表示）を確認する。
import type { Meta, StoryObj } from "@storybook/react-vite";
import { WikiListMenu } from "./WikiListMenu";
import { LocaleProvider, syncLocale } from "../../i18n";
import "../../app.css";

const meta: Meta<typeof WikiListMenu> = {
  title: "Molecules/WikiListMenu",
  component: WikiListMenu,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => {
      syncLocale("ja");
      return (
        <LocaleProvider>
          <div style={{ background: "var(--paper-2)", padding: 16, minHeight: 220 }}>
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
};
export default meta;

type Story = StoryObj<typeof WikiListMenu>;

// 描画後に「…」を押して開く
const openMenu: Story["play"] = async ({ canvasElement }) => {
  canvasElement.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.click();
};

export const OpenAll: Story = {
  name: "開いた状態（全項目）",
  args: { onFrameBackfill: () => {}, onShowLastBackfillResult: () => {}, onAsterismExport: () => {} },
  play: openMenu,
};

export const OpenBusy: Story = {
  name: "開いた状態（付け直しの実行中 = 項目無効）",
  args: { onFrameBackfill: () => {}, frameBackfillBusy: true, onShowLastBackfillResult: () => {} },
  play: openMenu,
};

export const OpenExportOnly: Story = {
  name: "開いた状態（連携オン・AI 無効 = 書き出しのみ）",
  args: { onAsterismExport: () => {} },
  play: openMenu,
};

export const Closed: Story = {
  name: "閉じた状態",
  args: { onFrameBackfill: () => {} },
};
