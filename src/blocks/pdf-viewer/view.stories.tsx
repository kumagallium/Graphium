// PdfViewerBlock のストーリー
// PDF 埋め込みブロックの見た目と操作を確認する

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Component, type ReactNode } from "react";
import { SandboxEditor } from "../../base/editor";
import { pdfViewerBlock } from "./index";

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
        <div
          style={{
            padding: 16,
            color: "#c26356",
            fontSize: 13,
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
        >
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
  title: "Blocks/PdfViewerBlock",
  parameters: { layout: "padded" },
};
export default meta;

// URL 未設定（プレースホルダ表示）
export const Empty: StoryObj = {
  name: "未設定（プレースホルダ）",
  render: () => (
    <Safe>
      <div
        style={{
          maxWidth: 800,
          border: "1px solid #e5e7eb",
          borderRadius: 12,
        }}
      >
        <SandboxEditor
          blocks={[pdfViewerBlock]}
          initialContent={[{ type: "pdf", props: { url: "", name: "" } }]}
        />
      </div>
    </Safe>
  ),
};

// PDF 表示（サンプル PDF）
export const WithPdf: StoryObj = {
  name: "PDF 表示（W3C PROV-DM）",
  render: () => (
    <Safe>
      <div
        style={{
          maxWidth: 800,
          border: "1px solid #e5e7eb",
          borderRadius: 12,
        }}
      >
        <SandboxEditor
          blocks={[pdfViewerBlock]}
          initialContent={[
            {
              type: "pdf",
              props: {
                url: "/sample.pdf",
                name: "sample.pdf",
              },
            },
          ]}
        />
      </div>
    </Safe>
  ),
};

// 他ブロックとの混在
export const MixedContent: StoryObj = {
  name: "他ブロックとの混在",
  render: () => (
    <Safe>
      <div
        style={{
          maxWidth: 800,
          border: "1px solid #e5e7eb",
          borderRadius: 12,
        }}
      >
        <SandboxEditor
          blocks={[pdfViewerBlock]}
          initialContent={[
            {
              type: "paragraph",
              content: [{ type: "text", text: "以下は埋め込み PDF です：" }],
            },
            {
              type: "pdf",
              props: {
                url: "/sample.pdf",
                name: "参考論文.pdf",
              },
            },
            {
              type: "paragraph",
              content: [
                { type: "text", text: "上記の論文を参照してください。" },
              ],
            },
          ]}
        />
      </div>
    </Safe>
  ),
};
