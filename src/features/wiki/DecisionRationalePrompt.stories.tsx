// DecisionRationalePrompt（判断の理由を書くパネル）のストーリー。
import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider, syncLocale } from "../../i18n";
import { DecisionRationaleDialog, DecisionRationalePrompt, type DecisionRationaleItem } from "./DecisionRationalePrompt";
import "../../app.css";

const meta: Meta = {
  title: "Molecules/DecisionRationalePrompt",
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "理由が書かれていない判断知見ごとに、行動の引用と 1 行入力を並べるパネル。送信は LLM を通さず、書いた文がそのまま元ノートと知見に入る。閉じても未送信の行は何も書かれない。",
      },
    },
  },
  decorators: [
    (Story) => {
      syncLocale("ja");
      return (
        <LocaleProvider>
          <div style={{ background: "var(--paper-2)", padding: 16 }}>
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
};
export default meta;

type Story = StoryObj;

const items: DecisionRationaleItem[] = [
  { wikiId: "w1", title: "測定前に試料を乾燥させた", action: "測定前に試料を 60 度で 2 時間乾燥させる", targetNoteId: "n1", targetNoteTitle: "実験メモ 1" },
  { wikiId: "w2", title: "初期設定をそのまま使った", action: "ライブラリの既定の設定のまま実行する", targetNoteId: "n1", targetNoteTitle: "実験メモ 1" },
  { wikiId: "w3", title: "別の手法に切り替えた", action: "解析を回帰からクラスタリングに切り替える。長い行動の記述でも折り返して表示されることを確認するための文。", targetNoteId: "n2", targetNoteTitle: "解析ログ" },
];

const noop = async () => {};

export const Single: Story = {
  render: () => <DecisionRationalePrompt items={items.slice(0, 1)} onSubmit={noop} onClose={() => {}} />,
};
export const Three: Story = {
  render: () => <DecisionRationalePrompt items={items} onSubmit={noop} onClose={() => {}} />,
};
export const WithDone: Story = {
  render: () => <DecisionRationalePrompt items={items} initialDoneIds={["w1"]} onSubmit={noop} onClose={() => {}} />,
};

/** 実際の配置: 画面中央のダイアログ（背景クリック・Esc で閉じる） */
export const InDialog: Story = {
  parameters: { layout: "fullscreen" },
  render: () => <DecisionRationaleDialog items={items} onSubmit={noop} onClose={() => {}} />,
};
