// AI チャットの Markdown 画像（外部画像は押すまで読み込まない）のストーリー
// - 外部画像: ホストを見せた枠（押すと読み込む）
// - data: の画像: 従来どおりそのまま表示

import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider } from "@/i18n";
import { GatedMarkdownImage } from "./gated-markdown-image";

const meta: Meta = {
  title: "Molecules/GatedMarkdownImage",
  decorators: [
    (Story) => (
      <LocaleProvider>
        <div style={{ padding: 24, width: 360, background: "var(--paper)" }}>
          <Story />
        </div>
      </LocaleProvider>
    ),
  ],
};
export default meta;

type Story = StoryObj;

/** 外部（https）の画像: 読み込む前の枠 */
export const External: Story = {
  render: () => <GatedMarkdownImage src="https://images.example.com/figure-1.png?token=abc" alt="図 1" />,
};

/** data: の画像: そのまま表示 */
export const Inline: Story = {
  render: () => (
    <GatedMarkdownImage
      src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='80' height='40'><rect width='80' height='40' fill='%23cde'/></svg>"
      alt="図"
    />
  ),
};
