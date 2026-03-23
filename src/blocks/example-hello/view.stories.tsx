// HelloBlock のストーリー
// 最小カスタムブロックの見た目を確認する

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Component, type ReactNode } from "react";
import { SandboxEditor } from "../../base/editor";
import { helloBlock } from "./index";

// ── エラーバウンダリ ──
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, color: "#c26356", fontSize: 13, fontFamily: "'Inter', system-ui, sans-serif" }}>
          <strong>描画エラー:</strong> {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

function Safe({ children }: { children: ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

const meta: Meta = {
  title: "Blocks/HelloBlock",
  parameters: { layout: "padded" },
};
export default meta;

// デフォルト（name = "World"）
export const Default: StoryObj = {
  name: "デフォルト（World）",
  render: () => (
    <Safe>
      <div style={{ maxWidth: 800, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <SandboxEditor
          blocks={[helloBlock]}
          initialContent={[
            { type: "hello", props: { name: "World" } },
          ]}
        />
      </div>
    </Safe>
  ),
};

// カスタム名前
export const CustomName: StoryObj = {
  name: "カスタム名前（provnote）",
  render: () => (
    <Safe>
      <div style={{ maxWidth: 800, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <SandboxEditor
          blocks={[helloBlock]}
          initialContent={[
            { type: "hello", props: { name: "provnote" } },
          ]}
        />
      </div>
    </Safe>
  ),
};

// 静的表示（エディタなし）
export const StaticView: StoryObj = {
  name: "静的表示（UI のみ）",
  render: () => (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <p style={{ fontSize: 12, color: "#6b7f6e", marginBottom: 12 }}>
        HelloBlock の見た目（エディタなし）
      </p>
      <div style={{ padding: "12px 16px", borderRadius: 8, background: "#f0f9ff", border: "1px solid #bae6fd", fontSize: 14 }}>
        Hello, <strong>eureco</strong>!
        <div style={{ marginTop: 4, fontSize: 12, color: "#64748b" }}>
          これはサンプルのカスタムブロックです
        </div>
      </div>
    </div>
  ),
};
