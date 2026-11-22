// 声の入力ボタンの表示確認（idle / 録音中 / 文字起こし中 / 各エラー）

import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider, syncLocale } from "../../i18n";
import { VoiceInputButtonView } from "./VoiceInputButton";

const meta: Meta<typeof VoiceInputButtonView> = {
  title: "Molecules/VoiceInputButton",
  component: VoiceInputButtonView,
  args: { status: "idle", level: 0, error: null, onToggle: () => {} },
  decorators: [
    (Story, context) => {
      syncLocale((context.parameters.locale as "ja" | "en" | undefined) ?? "ja");
      return (
        <LocaleProvider>
          {/* エラーはボタンの上に浮かぶので、上と左に余白を取り、ボタンを右寄せの入力欄の端に見立てる */}
          <div style={{ padding: "56px 16px 16px 320px", background: "var(--paper, #fff)" }}>
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
};
export default meta;
type Story = StoryObj<typeof VoiceInputButtonView>;

export const Idle: Story = {};
export const RecordingQuiet: Story = { args: { status: "recording", level: 0.01 } };
export const RecordingLoud: Story = { args: { status: "recording", level: 0.15 } };
export const Transcribing: Story = { args: { status: "transcribing" } };
export const ErrorModelMissing: Story = { args: { error: "model-missing" } };
export const ErrorNoSpeech: Story = { args: { error: "no-speech" } };
export const ErrorNoDevice: Story = { args: { error: "no-device" } };
export const ErrorFailed: Story = { args: { error: "failed" } };
export const English: Story = { args: { error: "model-missing" }, parameters: { locale: "en" } };
