// AI のつなぎ方の簡易表示のストーリー。まだ何もつないでいないときの最初の 1 枚。
// 今の画面（ConnectChooserView・「その他のつなぎ方」の先）と並べて比べられるようにする。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { CLOUD_PROVIDERS } from "../free-providers/catalog";
import { ConnectChooserView } from "./ConnectChooserView";
import { SimpleAiEntryView, type SimpleAiEntryViewProps } from "./SimpleAiEntryView";

const frame = (Story: () => React.ReactElement) => (
  <div className="w-[560px] rounded-lg border border-primary/30 bg-primary/5 p-4">
    <Story />
  </div>
);

const meta: Meta = {
  title: "Molecules/SimpleAiEntry",
  decorators: [frame],
};
export default meta;

const noop = () => {};

/** デスクトップ版: ChatGPT のプランと GitHub Copilot をその場でつなげる */
const desktop: SimpleAiEntryViewProps = {
  onConnectChatGpt: noop,
  onConnectCopilot: noop,
  onPickCustom: noop,
  onImportFile: noop,
  onShowAll: noop,
  onOpenDesktopDownload: noop,
  onOpenCopilotSettings: noop,
};

/** Web 版: ChatGPT のプランと GitHub Copilot はデスクトップ版への案内になる */
const web: SimpleAiEntryViewProps = {
  onPickCustom: noop,
  onShowAll: noop,
  onOpenDesktopDownload: noop,
};

/** 最初の 1 枚: いま使っている AI を 1 問だけ聞く */
export const Question: StoryObj = { render: () => <SimpleAiEntryView {...desktop} /> };

/** ChatGPT の有料プランを選んだところ（デスクトップ版）: ボタン 1 つ */
export const ChatGptDesktop: StoryObj = { render: () => <SimpleAiEntryView {...desktop} initialAnswer="chatgpt" /> };

/** GitHub Copilot を選んだところ（デスクトップ版）: 送り先と学習への利用は押す前に伝える */
export const CopilotDesktop: StoryObj = { render: () => <SimpleAiEntryView {...desktop} initialAnswer="copilot" /> };

/** 研究室・機関の接続先を選んだところ: 配られたファイルを先に。URL だけ渡された人は今のフォームへ */
export const LabConnection: StoryObj = { render: () => <SimpleAiEntryView {...desktop} initialAnswer="lab" /> };

/** Web 版で ChatGPT の有料プランを選んだところ: デスクトップ版への案内 */
export const ChatGptWeb: StoryObj = { render: () => <SimpleAiEntryView {...web} initialAnswer="chatgpt" /> };

/** Web 版で GitHub Copilot を選んだところ: デスクトップ版への案内 */
export const CopilotWeb: StoryObj = { render: () => <SimpleAiEntryView {...web} initialAnswer="copilot" /> };

/** 比べる用: 今の「どこにつなぎますか？」（デスクトップ版・すべて畳んだ状態） */
export const CurrentChooser: StoryObj = {
  render: () => (
    <ConnectChooserView
      cloudProviders={CLOUD_PROVIDERS}
      onConnectChatGpt={noop}
      onConnectCopilot={noop}
      onPickCloud={noop}
      onPickLocal={noop}
      onPickCustom={noop}
      onOpenCopilotSettings={noop}
      onOpenSignup={noop}
      onOpenComparison={noop}
    />
  ),
};
