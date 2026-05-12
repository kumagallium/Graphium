// Synthesis モード説明モーダルのビジュアル確認用ストーリー
// バッジから開く前提だが、ここでは常時 open=true で各モードを並べて見せる。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { SynthesisModeModal } from "./SynthesisModeModal";

const meta: Meta<typeof SynthesisModeModal> = {
  title: "Molecules/SynthesisModeModal",
  component: SynthesisModeModal,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "WikiBanner の synthesisMode バッジをクリックすると開くモーダル。選択中モードの説明・形・他モードへの俯瞰・学習材料へのリンク（docs/inference-types）を提示する。",
      },
    },
  },
  args: {
    open: true,
    onClose: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof SynthesisModeModal>;

export const Deductive: Story = {
  args: { mode: "deductive" },
};

export const Abductive: Story = {
  args: { mode: "abductive" },
};

export const Analogical: Story = {
  args: { mode: "analogical" },
};

export const Dialectic: Story = {
  args: { mode: "dialectic" },
};
