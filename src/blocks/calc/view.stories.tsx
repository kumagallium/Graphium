// CalcBlock のストーリー
// Numi 風のライブ計算ブロック（変数・単位・行ごとの結果表示）を確認する

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Component, type ReactNode } from "react";
import { SandboxEditor } from "../../base/editor";
import { calcBlock } from "./index";
import "../../app.css";
// SandboxEditor は note-app と同じ Context 群を要求する（chart のストーリーと同じ理由）
import {
  LabelStoreProvider,
  ProvLabelsEnabledProvider,
} from "../../features/context-label/store";
import { LinkStoreProvider } from "../../features/block-link/store";
import { IndexTableStoreProvider } from "../../features/index-table/store";
import { LogTableStoreProvider } from "../../features/log-table/store";
import { MediaInlineLabelProvider } from "../../features/inline-label/media-store";
import { BlockAlignmentProvider } from "../../features/block-alignment/store";
import { AiAssistantProvider } from "../../features/ai-assistant/store";

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

function EditorProviders({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <ProvLabelsEnabledProvider enabled={false}>
        <LabelStoreProvider>
          <LinkStoreProvider>
            <IndexTableStoreProvider>
              <LogTableStoreProvider>
                <MediaInlineLabelProvider>
                  <BlockAlignmentProvider>
                    <AiAssistantProvider aiAvailable={false}>{children}</AiAssistantProvider>
                  </BlockAlignmentProvider>
                </MediaInlineLabelProvider>
              </LogTableStoreProvider>
            </IndexTableStoreProvider>
          </LinkStoreProvider>
        </LabelStoreProvider>
      </ProvLabelsEnabledProvider>
    </ErrorBoundary>
  );
}

const meta: Meta = {
  title: "Blocks/CalcBlock",
  parameters: { layout: "padded" },
};
export default meta;

// 秤量計算の例（BaTiO3 の固相合成を想定）
const WEIGHING_SOURCE = [
  "# BaTiO3 5 g の秤量（BaCO3 + TiO2）",
  "target = 5 g",
  "BaCO3 = 197.34 g/mol",
  "TiO2 = 79.87 g/mol",
  "BaTiO3 = 233.19 g/mol",
  "",
  "mol = target / BaTiO3",
  "mol * BaCO3 to g",
  "mol * TiO2 to g",
].join("\n");

export const Weighing: StoryObj = {
  name: "秤量計算（デフォルト）",
  render: () => (
    <EditorProviders>
      <div style={{ maxWidth: 800, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <SandboxEditor
          blocks={[calcBlock]}
          initialContent={[
            {
              type: "calc",
              props: { source: WEIGHING_SOURCE, results: "" },
            },
          ]}
        />
      </div>
    </EditorProviders>
  ),
};

export const Empty: StoryObj = {
  name: "空の状態",
  render: () => (
    <EditorProviders>
      <div style={{ maxWidth: 800, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <SandboxEditor
          blocks={[calcBlock]}
          initialContent={[{ type: "calc", props: { source: "", results: "" } }]}
        />
      </div>
    </EditorProviders>
  ),
};

// 単位換算とエラー行が混ざったケース
export const UnitsAndErrors: StoryObj = {
  name: "単位換算とエラー行",
  render: () => (
    <EditorProviders>
      <div style={{ maxWidth: 800, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <SandboxEditor
          blocks={[calcBlock]}
          initialContent={[
            {
              type: "calc",
              props: {
                source: [
                  "// 単位換算",
                  "2.5 mL * 1.05 g/mL",
                  "300 K to degC",
                  "1 atm to kPa",
                  "",
                  "undefined_variable + 1",
                ].join("\n"),
                results: "",
              },
            },
          ]}
        />
      </div>
    </EditorProviders>
  ),
};
