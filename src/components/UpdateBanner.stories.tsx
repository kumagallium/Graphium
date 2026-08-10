import { useEffect } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { UpdateBanner } from "./UpdateBanner";
import type { UpdateAvailableDetail } from "../lib/updater";

// UpdateBanner は CustomEvent 駆動なので、ストーリー側でイベントを発火して表示させる
function BannerWithUpdate({ version }: { version: string }) {
  useEffect(() => {
    const detail: UpdateAvailableDetail = {
      version,
      install: () => new Promise(() => {}), // 押すと「ダウンロード中...」のまま
    };
    // マウント直後だとリスナー登録前に発火し得るため 1 tick 遅らせる
    const id = setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("graphium-update-available", { detail }),
      );
    }, 0);
    return () => clearTimeout(id);
  }, [version]);
  return <UpdateBanner />;
}

const meta: Meta<typeof UpdateBanner> = {
  title: "Components/UpdateBanner",
  component: UpdateBanner,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof UpdateBanner>;

// 更新あり: 「更新を確認」(枠線) と「再起動して更新」(塗り) の 2 ボタン構成
export const UpdateAvailable: Story = {
  render: () => <BannerWithUpdate version="0.29.0" />,
};
