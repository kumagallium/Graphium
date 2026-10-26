// 設定画面の「まとまりの見出し」と「項目」の階層の見せ方を見比べるストーリー（デザイン合意用）。
//
// いまは、まとまりの見出し（例: モデルの割り当て）と項目の見出し（デフォルトモデル）が
// 同じ大きさ・同じ字下げで並び、どこからどこまでが 1 つのまとまりか目がすべる。
// 中身は SettingSection（実物）で、まとまりの包み方だけを変えて並べる。
// 2026-10-27 に A（見出しを一段大きく＋字下げ）で合意し、SettingsGroup.tsx の定数で全体に当てた。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { SettingSection } from "./SettingSection";

function Select({ value }: { value: string }) {
  return (
    <div className="relative">
      <div className="w-full rounded-md border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground">{value}</div>
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

function Items() {
  return (
    <>
      <SettingSection title="デフォルトモデル" summary="ほかを空欄にしておけば、AI の機能はすべてこのモデルを使います" details={<p>使い道: …</p>}>
        <Select value="サーバーデフォルト (Claude Sonnet 5)" />
      </SettingSection>
      <SettingSection title="チャットモデル" summary="AI チャット・点検・トピックの統合に使うモデル" details={<p>使い道: …</p>}>
        <Select value="デフォルトモデルと同じ" />
      </SettingSection>
    </>
  );
}

/** いまの形: まとまりの見出しも項目も同じ大きさ・同じ字下げ */
function Current() {
  return (
    <div className="border-t border-border pt-6">
      <h3 className="text-xs font-semibold text-foreground mb-3">モデルの割り当て</h3>
      <div className="space-y-4">
        <Items />
      </div>
    </div>
  );
}

/** A: まとまりの見出しを一段大きくし、中の項目を字下げする */
function Indented() {
  return (
    <div className="border-t border-border pt-6">
      <h3 className="text-sm font-semibold text-foreground mb-3">モデルの割り当て</h3>
      <div className="space-y-4 pl-4">
        <Items />
      </div>
    </div>
  );
}

/** B: A に加えて、中の項目の左に細い線を引いて、まとまりの範囲を見せる */
function IndentedWithRule() {
  return (
    <div className="border-t border-border pt-6">
      <h3 className="text-sm font-semibold text-foreground mb-3">モデルの割り当て</h3>
      <div className="space-y-4 border-l border-border pl-4 ml-1">
        <Items />
      </div>
    </div>
  );
}

function Frame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="w-[520px]">
      <div className="mb-2 text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="rounded-xl border border-border bg-card px-5 pb-5">{children}</div>
    </div>
  );
}

const meta = {
  title: "Molecules/SettingsHierarchy",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Compare: Story = {
  name: "見比べ（いま / A 字下げ / B 字下げ＋左の線）",
  render: () => (
    <div className="flex flex-wrap gap-6 bg-background p-4">
      <Frame label="いま">
        <Current />
      </Frame>
      <Frame label="A: 見出しを一段大きく＋中身を字下げ（採用）">
        <Indented />
      </Frame>
      <Frame label="B: A＋左の細い線">
        <IndentedWithRule />
      </Frame>
    </div>
  ),
};
