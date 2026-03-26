// SandboxEditor のストーリー
// BlockNote エディタ基盤の各設定パターンを確認する

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Component, type ReactNode } from "react";
import { SandboxEditor } from "./editor";
import { helloBlock } from "../blocks/example-hello";

// ── エラーバウンダリ（BlockNote 初期化エラーを吸収） ──
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
  title: "Organisms/Editor",
  parameters: { layout: "padded" },
};
export default meta;

// デフォルト（空のエディタ）
export const Default: StoryObj = {
  name: "デフォルト",
  render: () => (
    <Safe>
      <div style={{ maxWidth: 800, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <SandboxEditor />
      </div>
    </Safe>
  ),
};

// 初期コンテンツ付き
export const WithInitialContent: StoryObj = {
  name: "初期コンテンツ付き",
  render: () => (
    <Safe>
      <div style={{ maxWidth: 800, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <SandboxEditor
          initialContent={[
            { type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Cu粉末アニール実験", styles: {} }] },
            { type: "paragraph", content: [{ type: "text", text: "電気炉でCu粉末をアニールし、XRDで評価する。", styles: {} }] },
            { type: "bulletListItem", content: [{ type: "text", text: "Cu粉末 1g", styles: {} }] },
            { type: "bulletListItem", content: [{ type: "text", text: "シリカ管", styles: {} }] },
          ]}
        />
      </div>
    </Safe>
  ),
};

// カスタムブロック付き
export const WithCustomBlock: StoryObj = {
  name: "カスタムブロック（HelloBlock）付き",
  render: () => (
    <Safe>
      <div style={{ maxWidth: 800, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <SandboxEditor
          blocks={[helloBlock]}
          initialContent={[
            { type: "heading", props: { level: 2 }, content: [{ type: "text", text: "サンプル実験", styles: {} }] },
            { type: "hello", props: { name: "provnote" } },
            { type: "paragraph", content: [{ type: "text", text: "↑ カスタムブロック「Hello」を含むエディタ", styles: {} }] },
          ]}
        />
      </div>
    </Safe>
  ),
};

// SideMenu なし
export const WithoutSideMenu: StoryObj = {
  name: "SideMenu なし",
  render: () => (
    <Safe>
      <div style={{ maxWidth: 800, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <SandboxEditor
          sideMenu={false}
          initialContent={[
            { type: "paragraph", content: [{ type: "text", text: "SideMenu を非表示にしたエディタ", styles: {} }] },
          ]}
        />
      </div>
    </Safe>
  ),
};
