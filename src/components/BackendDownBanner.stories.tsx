import { useEffect } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { BackendDownBanner } from "./BackendDownBanner";
import { __setSidecarStateForStory } from "../lib/sidecar";

// BackendDownBanner は sidecar.ts のモジュール状態を購読しているので、
// ストーリー側で「予期せぬ終了」の状態を差し込んで表示させる。
function BannerWithState({
  lastError,
  log,
}: {
  lastError: string | null;
  log?: string[];
}) {
  useEffect(() => {
    // マウント直後だと購読前に発火し得るため 1 tick 遅らせる
    const id = setTimeout(() => {
      __setSidecarStateForStory(
        { status: "failed", unexpectedExit: true, lastError, lastErrorAt: Date.now() },
        log,
      );
    }, 0);
    return () => {
      clearTimeout(id);
      // 次のストーリーへ状態を持ち越さない
      __setSidecarStateForStory({ status: "idle", unexpectedExit: false, lastError: null, lastErrorAt: null }, []);
    };
  }, [lastError, log]);
  return <BackendDownBanner />;
}

const meta: Meta<typeof BackendDownBanner> = {
  title: "Components/BackendDownBanner",
  component: BackendDownBanner,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof BackendDownBanner>;

// 典型: sidecar がシグナルで死んだ（Tauri の exit 通知がそのまま入る）
export const UnexpectedExit: Story = {
  render: () => (
    <BannerWithState
      lastError="exit code=None success=false"
      log={[
        "[server-boot] listening on 127.0.0.1:3001",
        "Graphium backend running on http://127.0.0.1:3001",
        "[agent.chat] {\"provider\":\"openai-compatible\",\"toolsUsed\":[],\"webSourceCount\":0}",
        "Wiki embed error: AI_APICallError: Bad Request",
        "[lifecycle] process closed exit code=None success=false",
      ]}
    />
  ),
};

// 終了情報が取れなかった場合（メッセージだけ）
export const WithoutDetail: Story = {
  render: () => <BannerWithState lastError={null} />,
};

// 更新バナーとの並び（両方出たときの見え方）
export const StackedWithUpdateBanner: Story = {
  render: () => (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 12,
          padding: "6px 16px",
          background: "#edf5ee",
          borderBottom: "1px solid #c5ddc8",
          fontSize: 13,
          color: "#2d5a32",
        }}
      >
        <span>Graphium 0.40.0 が利用可能です</span>
      </div>
      <BannerWithState lastError="exit code=None success=false" />
    </div>
  ),
};
