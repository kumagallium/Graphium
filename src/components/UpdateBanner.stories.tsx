import { useEffect } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { UpdateBanner } from "./UpdateBanner";
import type { UpdateAvailableDetail } from "../lib/updater";

// UpdateBanner は CustomEvent 駆動なので、ストーリー側でイベントを発火して表示させる
function BannerWithUpdate({
  version,
  install,
}: {
  version: string;
  install: UpdateAvailableDetail["install"];
}) {
  useEffect(() => {
    const detail: UpdateAvailableDetail = { version, install };
    // マウント直後だとリスナー登録前に発火し得るため 1 tick 遅らせる
    const id = setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("graphium-update-available", { detail }),
      );
    }, 0);
    return () => clearTimeout(id);
  }, [version, install]);
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
  render: () => (
    <BannerWithUpdate version="0.29.0" install={() => new Promise(() => {})} />
  ),
};

// ダウンロード進捗中: onProgress に継続的に進捗を流し、百分率表示を確認する
export const Downloading: Story = {
  render: () => (
    <BannerWithUpdate
      version="0.29.0"
      install={(onProgress) =>
        new Promise(() => {
          let downloaded = 0;
          const total = 42 * 1024 * 1024;
          onProgress({ phase: "downloading", downloaded, total });
          setInterval(() => {
            downloaded = Math.min(downloaded + 4 * 1024 * 1024, total);
            onProgress({ phase: "downloading", downloaded, total });
          }, 800);
        })
      }
    />
  ),
};

// エラー表示: install が reject し、バナー内にエラーメッセージが出ることを確認する
export const InstallError: Story = {
  render: () => (
    <BannerWithUpdate
      version="0.29.0"
      install={() => Promise.reject(new Error("Network error"))}
    />
  ),
};
