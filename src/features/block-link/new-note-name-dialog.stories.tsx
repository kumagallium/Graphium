// `@` メニュー「新しいノートを作成」で開くノート名入力ダイアログのビジュアル確認。
// 実際は Promise ベースの useNewNoteNamePrompt から開くが、ここでは常時表示で見せる。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { NewNoteNameDialog } from "./new-note-name-dialog";

const meta: Meta<typeof NewNoteNameDialog> = {
  title: "Molecules/NewNoteNameDialog",
  component: NewNoteNameDialog,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "`@` メニューの「新しいノートを作成…」を選ぶと開く。サジェストメニュー内で日本語を打つと IME 変換確定でメニューが閉じてしまうため、名前入力だけを通常の入力欄に切り出している。Enter で作成・Esc でキャンセル（変換確定の Enter は無視）。",
      },
    },
  },
  args: {
    onConfirm: () => {},
    onCancel: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof NewNoteNameDialog>;

export const Empty: Story = {
  args: { initial: "" },
};

export const Prefilled: Story = {
  args: { initial: "細孔径と選択性" },
};
