// LocalEmbeddingModelView — 設定 > AI > 埋め込みモデルで「このパソコンで」を選んだときの取得行

import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocalEmbeddingModelView } from "./LocalEmbeddingModelSection";

const meta: Meta<typeof LocalEmbeddingModelView> = {
  title: "Molecules/LocalEmbeddingModelSection",
  component: LocalEmbeddingModelView,
  args: {
    name: "bge-m3",
    status: { name: "bge-m3", version: "local:bge-m3-q8", dims: 1024, present: false, bytes: 0, expectedBytes: 586_780_258 },
    downloading: null,
    onDownload: () => {},
    onCancel: () => {},
    onDelete: () => {},
  },
  decorators: [(Story) => <div className="w-[480px] bg-background p-4"><Story /></div>],
};
export default meta;

type Story = StoryObj<typeof LocalEmbeddingModelView>;

export const NotDownloaded: Story = {};

export const Downloading: Story = {
  args: { downloading: { received: 180_000_000, total: 586_780_258 } },
};

export const Downloaded: Story = {
  args: { status: { name: "bge-m3", version: "local:bge-m3-q8", dims: 1024, present: true, bytes: 586_780_258, expectedBytes: 586_780_258 } },
};

export const LightModel: Story = {
  args: {
    name: "multilingual-e5-small",
    status: { name: "multilingual-e5-small", version: "local:multilingual-e5-small-q8", dims: 384, present: true, bytes: 135_392_000, expectedBytes: 135_392_000 },
  },
};

export const Failed: Story = {
  args: { error: "HTTP 503" },
};

export const StatusUnknown: Story = {
  args: { status: null },
};
