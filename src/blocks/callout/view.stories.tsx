// CalloutBlock のストーリー
// Notion 風コールアウト（絵文字 + 色付き枠 + 本文編集）の見た目を確認する

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Component, type ReactNode } from "react";
import { SandboxEditor } from "../../base/editor";
import { calloutBlock } from "./index";

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
  title: "Blocks/CalloutBlock",
  parameters: { layout: "padded" },
};
export default meta;

// デフォルト（note）
export const Default: StoryObj = {
  name: "デフォルト（ノート）",
  render: () => (
    <Safe>
      <div style={{ maxWidth: 800, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <SandboxEditor
          blocks={[calloutBlock]}
          initialContent={[
            {
              type: "callout",
              props: { variant: "note" },
              content: [{ type: "text", text: "ここに補足やヒントを書けます。アイコンをクリックすると種類を変更できます。", styles: {} }],
            },
          ]}
        />
      </div>
    </Safe>
  ),
};

// 全 variant（デザイントークン準拠の配色）
export const Variants: StoryObj = {
  name: "種類バリエーション",
  render: () => (
    <Safe>
      <div style={{ maxWidth: 800, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <SandboxEditor
          blocks={[calloutBlock]}
          initialContent={[
            {
              type: "callout",
              props: { variant: "info" },
              content: [{ type: "text", text: "情報: 補足的な背景情報を伝えます。", styles: {} }],
            },
            {
              type: "callout",
              props: { variant: "success" },
              content: [{ type: "text", text: "成功: テストが全て通りました。", styles: {} }],
            },
            {
              type: "callout",
              props: { variant: "warning" },
              content: [{ type: "text", text: "注意: 破壊的な操作の前に確認してください。", styles: {} }],
            },
            {
              type: "callout",
              props: { variant: "danger" },
              content: [{ type: "text", text: "危険: この操作は元に戻せません。", styles: {} }],
            },
            {
              type: "callout",
              props: { variant: "note", textAlignment: "center" },
              content: [{ type: "text", text: "中央揃えのコールアウト", styles: {} }],
            },
          ]}
        />
      </div>
    </Safe>
  ),
};
