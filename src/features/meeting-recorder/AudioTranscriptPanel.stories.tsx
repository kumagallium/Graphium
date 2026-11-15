// AudioTranscriptPanel — 音声素材のプレビュー下の文字起こし欄
// 表示だけの部分（AudioTranscriptPanelView）を状態ごとに並べる。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { AudioTranscriptPanelView } from "./AudioTranscriptPanel";

const meta: Meta<typeof AudioTranscriptPanelView> = {
  title: "Molecules/AudioTranscriptPanel",
  component: AudioTranscriptPanelView,
  parameters: { layout: "centered" },
  args: {
    canTranscribe: true,
    busy: false,
    downloading: false,
    waitingModel: false,
    modelMb: 574,
    modelPercent: 0,
    notice: null,
    modelMissing: false,
    text: null,
    onStart: () => {},
  },
};
export default meta;

type Story = StoryObj<typeof AudioTranscriptPanelView>;

export const Idle: Story = {};

/** モデルを取得している（受信箱・設定など、ほかの場所で始まった取得） */
export const Downloading: Story = {
  args: { downloading: true, modelPercent: 12 },
};

/** このパネルのボタンが取得を待っている。終わったら文字起こしを始める */
export const WaitingForModel: Story = {
  args: { downloading: true, waitingModel: true, modelPercent: 40 },
};

/** 取得できず、設定での取得を案内する */
export const ModelMissing: Story = {
  args: { modelMissing: true },
};

/** 形式を読めなかった */
export const Unreadable: Story = { args: { notice: "unreadable" } };

/** 2 時間を超えている */
export const TooLong: Story = { args: { notice: "too-long" } };

/** ファイルが大きすぎる */
export const TooLarge: Story = { args: { notice: "too-large" } };

/** 変換・受け渡しがうまくいかなかった */
export const Failed: Story = { args: { notice: "failed" } };

/** 別の処理が進んでいる（Rust が処理中を返した） */
export const BusyElsewhere: Story = { args: { notice: "busy" } };

/** 文字起こし中（ボタンは押せない） */
export const Running: Story = { args: { busy: true } };

export const WithTranscript: Story = {
  args: { text: "[00:00] こんにちは。今日は実験の手順を確認します。\n[00:08] まず試料を秤量します。" },
};
