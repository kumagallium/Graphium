// CollapsibleSection — サイドバーの折り畳みセクションのカタログ

import type { Meta, StoryObj } from "@storybook/react-vite";
import { CollapsibleSection } from "./CollapsibleSection";

const meta: Meta<typeof CollapsibleSection> = {
  title: "Molecules/CollapsibleSection",
  component: CollapsibleSection,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-64 bg-sidebar-background border border-sidebar-border rounded">
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof CollapsibleSection>;

const SampleRows = () => (
  <>
    <div className="px-2 py-1 text-sm text-sidebar-foreground/70">Item one</div>
    <div className="px-2 py-1 text-sm text-sidebar-foreground/70">Item two</div>
    <div className="px-2 py-1 text-sm text-sidebar-foreground/70">Item three</div>
  </>
);

export const OpenByDefault: Story = {
  args: {
    storageKey: "story-open",
    title: "Notes",
    defaultOpen: true,
    children: <SampleRows />,
  },
};

export const ClosedByDefault: Story = {
  args: {
    storageKey: "story-closed",
    title: "AI",
    defaultOpen: false,
    count: 12,
    children: <SampleRows />,
  },
};

export const WithCount: Story = {
  args: {
    storageKey: "story-count",
    title: "Data",
    defaultOpen: true,
    count: 27,
    children: <SampleRows />,
  },
};

export const ZeroCount: Story = {
  args: {
    storageKey: "story-zero",
    title: "Library",
    defaultOpen: false,
    count: 0,
    children: <SampleRows />,
  },
};
