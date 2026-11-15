// InboxTranscribeToast — 受信箱から届いた音声の文字起こしの知らせ
// 右下に fixed 表示。モデルの取得中は出したまま、取得の完了は数秒で消え、
// 文字にできなかった音声・モデルが無い知らせは閉じるボタンで消す。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { InboxTranscribeToast } from "./InboxTranscribeToast";

const meta: Meta<typeof InboxTranscribeToast> = {
  title: "Molecules/InboxTranscribeToast",
  component: InboxTranscribeToast,
  parameters: { layout: "fullscreen" },
  args: { onDismiss: () => {}, stacked: false },
  decorators: [(Story) => <div className="min-h-[240px] p-4"><Story /></div>],
};
export default meta;

type Story = StoryObj<typeof InboxTranscribeToast>;

/** モデルを取得している間。止め方の案内つきで、取得が続くあいだ消えない */
export const Downloading: Story = {
  args: { state: { download: { mb: 574, percent: 12 }, modelReady: false, notices: [] } },
};

/** 取得が終わった。数秒で自然に消える */
export const ModelReady: Story = {
  args: { state: { download: null, modelReady: true, notices: [] } },
};

/** 文字にできなかった音声。成功にも失敗にも見せない中立の知らせ。閉じるまで残る */
export const Skipped: Story = {
  args: {
    state: {
      download: null,
      modelReady: false,
      notices: [{ id: "a", text: "音声 2 件は文字起こしできませんでした。音声はそのまま残っています" }],
    },
  },
};

/** モデルが無く文字起こししていない。音声を開いて「文字起こし」を押せば取得できる */
export const NoModel: Story = {
  args: {
    state: {
      download: null,
      modelReady: false,
      notices: [
        {
          id: "m",
          text: "文字起こしモデルがまだ使えないため、音声 3 件は文字起こししていません。音声はそのまま残っています。音声を開いて「文字起こし」を押すと、モデルを取得して文字起こしします",
        },
      ],
    },
  },
};

/** 取得のあとに、文字にできなかった音声の知らせが続く */
export const DownloadedThenSkipped: Story = {
  args: {
    state: {
      download: null,
      modelReady: true,
      notices: [{ id: "a", text: "音声 1 件は長すぎて文字起こしできませんでした（2 時間までです）。音声はそのまま残っています" }],
    },
  },
};
