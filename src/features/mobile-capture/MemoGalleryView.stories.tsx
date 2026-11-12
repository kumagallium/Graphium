// MemoGalleryView のストーリー（リスト表示の列の見た目確認用）。見本はパン作り。
// 「使用」はノート一覧・ナレッジ一覧の被参照と同じ見た目（← N）で、どのメモにも値が無いときは
// 列ごと出ない。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoGalleryView } from "./MemoGalleryView";
import { LocaleProvider } from "../../i18n";
import type { CaptureEntry, CaptureIndex } from "./capture-store";
import "../../app.css";

const daysAgo = (d: number) => new Date(Date.now() - d * 86400_000).toISOString();

function used(...titles: string[]): CaptureEntry["usedIn"] {
  return titles.map((noteTitle, i) => ({ noteId: `n${i}-${noteTitle}`, noteTitle, insertedAt: daysAgo(1) }));
}

const MEMOS: CaptureEntry[] = [
  { id: "m1", text: "加水率 75% は手ごねだとべたつく。打ち粉を増やすより水回しを 2 回に分ける", createdAt: daysAgo(1), noteContexts: ["パン/加水"], usedIn: used("高加水カンパーニュの試作（3 回目）", "加水率の比較") },
  { id: "m2", text: "冷蔵発酵は 12 時間を超えると酸味が立つ", createdAt: daysAgo(2), noteContexts: ["パン/発酵"], usedIn: used("冷蔵発酵の比較メモ"), knowledgedInto: [{ noteId: "w1", noteTitle: "一次発酵を冷蔵で一晩おくと酸味が増す", knowledgedAt: daysAgo(1) }] },
  { id: "m3", text: "オーブンの予熱は 30 分。石を入れるなら 45 分", createdAt: daysAgo(3), usedIn: [] },
  { id: "m4", text: "塩は粉に対して 2%。後入れにするとこね上がりが早い", createdAt: daysAgo(5), usedIn: used("塩の後入れ", "基本の配合", "こね時間の記録") },
];

const index = (captures: CaptureEntry[]): CaptureIndex => ({ version: 1, updatedAt: daysAgo(0), captures });

const meta: Meta<typeof MemoGalleryView> = {
  title: "Features/MemoGalleryView",
  component: MemoGalleryView,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => {
      // リスト表示で開く（表示の切り替えは localStorage に覚えている）
      try {
        localStorage.setItem("graphium:memoViewMode", "list");
      } catch {
        /* 使えない環境ではギャラリー表示のまま */
      }
      return (
        <LocaleProvider>
          <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
};
export default meta;

type Story = StoryObj<typeof MemoGalleryView>;

export const ListWithUsage: Story = {
  name: "リスト表示（使用とフォルダの列あり）",
  args: { captureIndex: index(MEMOS), loading: false, onBack: () => {} },
};

export const ListWithoutUsage: Story = {
  name: "リスト表示（どのメモも未使用・フォルダなし = 使用とフォルダの列なし）",
  args: {
    captureIndex: index(MEMOS.map((m) => ({ ...m, usedIn: [], knowledgedInto: undefined, noteContexts: undefined }))),
    loading: false,
    onBack: () => {},
  },
};
