// 計画ノートの印の Storybook ストーリー
// 開いたノートのヘッダーの札と、一覧の行のアイコンを、隣に出る共有の印と並べて確かめる

import type { Meta, StoryObj } from "@storybook/react-vite";
import { MoreHorizontal, Share2 } from "lucide-react";
import { PlanNoteChip, PlanNoteMark } from "./plan-note-mark";
import "../app.css";

const meta: Meta = {
  title: "Components/PlanNoteMark",
  parameters: { layout: "padded" },
};
export default meta;

/** 開いたノートのヘッダー。計画の札は題の左、保存の状態や共有済みの札は右 */
export const HeaderChip: StoryObj = {
  name: "ヘッダーの札（計画のノート）",
  render: () => (
    <div className="w-[640px] border border-border rounded-md bg-background">
      <div className="px-4 py-2 border-b border-border flex items-center gap-3">
        <PlanNoteChip />
        <div className="flex-1 min-w-0 text-sm font-medium text-muted-foreground truncate">
          Cu粉末の焼結条件を詰める
        </div>
        <span className="text-[10px] text-muted-foreground shrink-0">保存済み</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary shrink-0 inline-flex items-center gap-1">
          <Share2 size={10} />
          共有済み
        </span>
        <MoreHorizontal size={16} className="text-muted-foreground" />
      </div>
    </div>
  ),
};

/** 一覧の行。計画のアイコンは題のすぐ右、共有の印の手前 */
export const ListMark: StoryObj = {
  name: "一覧の行のアイコン",
  render: () => (
    <table className="w-[480px] text-sm">
      <tbody>
        <tr className="border-b border-border">
          <td className="py-2 px-3">
            <span className="text-foreground">Cu粉末の焼結条件を詰める</span>
            <PlanNoteMark />
          </td>
        </tr>
        <tr className="border-b border-border">
          <td className="py-2 px-3">
            <span className="text-foreground">Cu粉末の焼結実験（第1回）</span>
            <span className="ml-1.5 inline-flex align-middle text-primary"><Share2 size={12} /></span>
          </td>
        </tr>
        <tr>
          <td className="py-2 px-3">
            <span className="text-foreground">XRD 分析結果</span>
          </td>
        </tr>
      </tbody>
    </table>
  ),
};
