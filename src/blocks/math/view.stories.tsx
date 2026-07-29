// MathBlock のストーリー
// KaTeX で描画するブロック数式と、本文中のインライン数式の見た目を確認する

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Component, type ReactNode } from "react";
import { SandboxEditor } from "../../base/editor";
import { mathBlock } from "./index";

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
  title: "Blocks/MathBlock",
  parameters: { layout: "padded" },
};
export default meta;

// 論文取り込みで実際に出てくる形（Anderson & Schooler 1991 の式）
export const Default: StoryObj = {
  name: "デフォルト（ブロック数式）",
  render: () => (
    <Safe>
      <div style={{ maxWidth: 800, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <SandboxEditor
          blocks={[mathBlock]}
          initialContent={[
            {
              type: "paragraph",
              content: [{ type: "text", text: "パフォーマンス指標と時間指標の両方に対数変換を行うと、線形関係が得られる。", styles: {} }],
            },
            {
              type: "math",
              props: { latex: "\\text{Log }P = \\log A - b \\log T \\quad (4)" },
            },
            {
              type: "paragraph",
              content: [{ type: "text", text: "クリックすると LaTeX を直接編集できる。", styles: {} }],
            },
          ]}
        />
      </div>
    </Safe>
  ),
};

// 状態バリエーション: 空・複数行・解釈できない式
export const States: StoryObj = {
  name: "状態バリエーション",
  render: () => (
    <Safe>
      <div style={{ maxWidth: 800, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <SandboxEditor
          blocks={[mathBlock]}
          initialContent={[
            {
              type: "paragraph",
              content: [{ type: "text", text: "分数・総和・行列など複数行の式:", styles: {} }],
            },
            {
              type: "math",
              props: { latex: "\\sum_{i=1}^{n} \\frac{x_i - \\bar{x}}{\\sigma} = \\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}" },
            },
            {
              type: "paragraph",
              content: [{ type: "text", text: "KaTeX が解釈できない式は、生ソースを残したまま知らせる:", styles: {} }],
            },
            {
              type: "math",
              props: { latex: "\\unknowncommand{x}" },
            },
          ]}
        />
      </div>
    </Safe>
  ),
};

// インライン数式（本文に混ざる形）
export const Inline: StoryObj = {
  name: "インライン数式",
  render: () => (
    <Safe>
      <div style={{ maxWidth: 800, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <SandboxEditor
          blocks={[mathBlock]}
          initialContent={[
            {
              type: "paragraph",
              content: [
                { type: "text", text: "対数尺度上では非常に良い線形近似が得られ、", styles: {} },
                { type: "inlineMath", props: { latex: "\\log A = 3.862" } },
                { type: "text", text: " かつ ", styles: {} },
                { type: "inlineMath", props: { latex: "b = -0.126" } },
                { type: "text", text: " である。", styles: {} },
              ],
            },
          ]}
        />
      </div>
    </Safe>
  ),
};
