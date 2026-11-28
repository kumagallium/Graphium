import type { Meta, StoryObj } from "@storybook/react-vite";
import { UpdateReadyBanner } from "./UpdateReadyBanner";

const meta: Meta<typeof UpdateReadyBanner> = {
  title: "MobileCapture/UpdateReadyBanner",
  component: UpdateReadyBanner,
  args: { onReload: () => {} },
  decorators: [
    (Story) => (
      <div style={{ width: 375 }} className="bg-background">
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof UpdateReadyBanner>;

export const Default: Story = {};
