// FreeProviderCardView — つなぎ先の選択画面（ai-connect）の「API キーでつなぐ」に並ぶ 1 社分のカード

import type { Meta, StoryObj } from "@storybook/react-vite";
import { CLOUD_PROVIDERS } from "./catalog";
import { FreeProviderCardView } from "./FreeProviderCardView";

const meta: Meta<typeof FreeProviderCardView> = {
  title: "Molecules/CloudProviderCard",
  component: FreeProviderCardView,
  args: { onOpenSignup: () => {}, onConnect: () => {} },
  decorators: [
    (Story) => (
      <div className="w-[420px] rounded-lg border border-dashed border-border bg-background p-4">
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof FreeProviderCardView>;
const byId = (id: string) => CLOUD_PROVIDERS.find((p) => p.id === id)!;

/** 無料枠があり、学習に使わない接続先（ふつうの文字色） */
export const FreeTierNotTrained: Story = { args: { provider: byId("cloudflare-workers-ai") } };

/** 学習に使う接続先は、その行だけ警告色 */
export const FreeTierTrained: Story = { args: { provider: byId("google-gemini") } };

/** 量が出せない接続先（数字を作らず、その理由を書く） */
export const AmountUnknown: Story = { args: { provider: byId("mistral") } };

/** 無料枠の無い接続先（使った分だけ請求） */
export const NoFreeTier: Story = { args: { provider: byId("openai") } };
