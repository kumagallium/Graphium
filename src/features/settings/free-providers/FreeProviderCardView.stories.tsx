// FreeProviderCardView / FreeProviderListView — 設定 > AI の空状態に出す「無料枠のある接続先」

import type { Meta, StoryObj } from "@storybook/react-vite";
import { FREE_PROVIDERS } from "./catalog";
import { FreeProviderCardView, FreeProviderListView } from "./FreeProviderCardView";

const frame = (Story: () => React.ReactElement) => (
  <div className="w-[420px] rounded-lg border border-dashed border-border bg-background p-4">
    <Story />
  </div>
);

const meta: Meta<typeof FreeProviderListView> = {
  title: "Molecules/FreeProviderList",
  component: FreeProviderListView,
  args: {
    providers: FREE_PROVIDERS,
    onOpenSignup: () => {},
    onConnect: () => {},
    onOpenComparison: () => {},
  },
  decorators: [frame],
};
export default meta;

type Story = StoryObj<typeof FreeProviderListView>;

/** 一覧: 全社が同じ形・同じ重さで、名前の順に並ぶ */
export const List: Story = {};

/** 確認日から 180 日を過ぎた一覧: 見出しの下に「古い可能性」が出る */
export const Stale: Story = { args: { now: new Date("2027-06-01T00:00:00Z") } };

const byId = (id: string) => FREE_PROVIDERS.find((p) => p.id === id)!;

/** カード 1 枚: 学習に使わない接続先（ふつうの文字色） */
export const CardTrainingNotUsed: StoryObj<typeof FreeProviderCardView> = {
  render: () => (
    <FreeProviderCardView provider={byId("cloudflare-workers-ai")} onOpenSignup={() => {}} onConnect={() => {}} />
  ),
};

/** カード 1 枚: 学習に使う接続先は、その行だけ警告色 */
export const CardTrainingUsed: StoryObj<typeof FreeProviderCardView> = {
  render: () => <FreeProviderCardView provider={byId("google-gemini")} onOpenSignup={() => {}} onConnect={() => {}} />,
};

/** カード 1 枚: 量が出せない接続先（数字を作らず、その理由を書く） */
export const CardAmountUnknown: StoryObj<typeof FreeProviderCardView> = {
  render: () => <FreeProviderCardView provider={byId("mistral")} onOpenSignup={() => {}} onConnect={() => {}} />,
};
