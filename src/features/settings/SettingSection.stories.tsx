// 設定セクションのストーリー。
//
// 「説明を全部出す」と「要約 1 行 ＋ くわしく」を並べて、同じ情報量が
// どれだけの高さになるかを見比べるためのもの。文言はストレージタブの実物を使う。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { FolderOpen, Share2, Smartphone } from "lucide-react";
import { Input } from "@ui/form-field";
import { Button } from "@ui/button";
import { SettingSection } from "./SettingSection";

const meta = {
  title: "Molecules/SettingSection",
  component: SettingSection,
  parameters: { layout: "padded" },
} satisfies Meta<typeof SettingSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 要約だけで足りる設定（補足が無いのでトグルも出ない）。 */
export const SummaryOnly: Story = {
  args: {
    icon: FolderOpen,
    title: "ノートの置き場所",
    summary: "ノート・画像・ナレッジが保存されるフォルダです。",
    children: (
      <div className="rounded-md border border-border bg-background px-3 py-2 flex items-center justify-between gap-2">
        <span className="text-xs font-mono text-foreground break-all">
          /Users/you/Documents/Graphium
        </span>
        <Button size="sm" variant="ghost" className="shrink-0">変更…</Button>
      </div>
    ),
  },
};

/** 条件や注意が長い設定。要約だけ見えて、残りは「くわしく」の中にある。 */
export const WithDetails: Story = {
  args: {
    icon: Share2,
    title: "チームと共有する",
    summary: "研究室の共有フォルダを指定すると、ノートを人に渡せるようになります。",
    details: (
      <div className="space-y-1.5">
        <p>
          NAS や Dropbox の同期フォルダを指定します。設定すると、ノートの ⋯ メニューに
          「チームと共有」が出て、共有されたものはサイドバーの「ライブラリ → 共有」に並びます。
        </p>
        <p>
          共有フォルダを読める人は誰でも同じものを読めます（アプリ内の権限制御はありません）。
        </p>
        <p>設定はこの端末に保存されます。削除すると _meta/ に記録が残ります。</p>
      </div>
    ),
    children: (
      <div className="flex items-center gap-2">
        <Input placeholder="未設定" readOnly />
        <Button size="sm" variant="ghost" className="shrink-0">フォルダを選択</Button>
      </div>
    ),
  },
};

/** 移行期の確認用。details を最初から開いた状態。 */
export const DetailsOpen: Story = {
  args: { ...WithDetails.args, defaultOpen: true },
};

/**
 * いまのストレージタブの組み方（説明を全部出す）と、この部品に置き換えたときの比較。
 * 情報は落とさず、最初に目に入る量だけを変えている。
 */
export const BeforeAfter: Story = {
  args: { title: "" },
  render: () => (
    <div className="grid grid-cols-2 gap-8 max-w-4xl">
      <div className="space-y-6">
        <p className="text-[11px] font-semibold text-muted-foreground">いま</p>
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <Share2 size={14} className="text-muted-foreground" />
            <h3 className="text-xs font-semibold text-foreground">共有ストレージ</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            研究室の NAS や Dropbox 同期フォルダなどを指定して、ノート・文献・コンセプトを
            チームと共有できるようにします。設定後は、ノートの ⋯ メニューから「チームと共有」を
            選ぶと公開され、共有されたものはサイドバーの「ライブラリ → 共有」に並びます。
          </p>
          <div className="flex items-center gap-2">
            <Input placeholder="未設定" readOnly />
            <Button size="sm" variant="ghost" className="shrink-0">フォルダを選択</Button>
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <Smartphone size={14} className="text-muted-foreground" />
            <h3 className="text-xs font-semibold text-foreground">モバイル送信</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            スマホで撮ったものをクラウドストレージ経由でデスクトップに送ります。
            この端末は同期フォルダから取り込む側です。
          </p>
          <p className="text-xs text-muted-foreground mb-2">
            クラウドストレージが同期しているフォルダを選んでください。Graphium はその中の
            Inbox サブフォルダを読みます。
          </p>
          <Button size="sm" variant="ghost">受信フォルダを選ぶ</Button>
        </div>
      </div>

      <div className="space-y-6">
        <p className="text-[11px] font-semibold text-muted-foreground">この部品に置き換えると</p>
        <SettingSection
          icon={Share2}
          title="チームと共有する"
          summary="研究室の共有フォルダを指定すると、ノートを人に渡せるようになります。"
          details={
            <p>
              設定後は、ノートの ⋯ メニューから「チームと共有」を選ぶと公開され、共有されたものは
              サイドバーの「ライブラリ → 共有」に並びます。共有フォルダを読める人は誰でも
              同じものを読めます。
            </p>
          }
        >
          <div className="flex items-center gap-2">
            <Input placeholder="未設定" readOnly />
            <Button size="sm" variant="ghost" className="shrink-0">フォルダを選択</Button>
          </div>
        </SettingSection>
        <SettingSection
          icon={Smartphone}
          title="スマホから送る"
          summary="スマホで撮った写真を、この PC に届くようにします。"
          details={
            <p>
              クラウドストレージが同期しているフォルダを選んでください。Graphium はその中の
              Inbox サブフォルダを読みます。
            </p>
          }
        >
          <Button size="sm" variant="ghost">受信フォルダを選ぶ</Button>
        </SettingSection>
      </div>
    </div>
  ),
};
