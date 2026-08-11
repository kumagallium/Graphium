// 記録テーブルのストーリー
// 「+ 記録」ボタン（LogTableAddRecordLayer）が登録済みテーブルの左下に出て、
// クリックで現在日時入りの行が追加されることを目視確認する。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Component, useEffect, useRef, type ReactNode } from "react";
import { SandboxEditor } from "../../base/editor";
import "../../app.css";
import {
  LabelStoreProvider,
  ProvLabelsEnabledProvider,
} from "../context-label/store";
import { LinkStoreProvider } from "../block-link/store";
import { IndexTableStoreProvider } from "../index-table/store";
import { LogTableStoreProvider, useLogTableStore } from "./store";
import { LogTableAddRecordLayer } from "./add-record-layer";
import { MediaInlineLabelProvider } from "../inline-label/media-store";
import { BlockAlignmentProvider } from "../block-alignment/store";
import { AiAssistantProvider } from "../ai-assistant/store";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, color: "#c26356", fontSize: 13 }}>
          <strong>描画エラー:</strong> {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

function EditorProviders({ children }: { children: ReactNode }) {
  return (
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
  );
}

const cell = (text: string) => [{ type: "text", text, styles: {} }];

const TABLE_ID = "log-table-demo";

function logTableContent() {
  return [
    {
      type: "paragraph",
      content: cell("記録テーブル。左下の「+ 記録」で現在日時入りの行が増える。"),
    },
    {
      id: TABLE_ID,
      type: "table",
      content: {
        type: "tableContent",
        rows: [
          { cells: [cell("日時"), cell("値"), cell("メモ")] },
          { cells: [cell("2026-08-11 08:15"), cell("7"), cell("台風")] },
        ],
      },
    },
    { type: "paragraph", content: cell("テーブルの後ろの段落。") },
  ];
}

// LogTableStoreProvider の内側で register と Layer を配線するデモ本体
function LogTableDemoInner() {
  const editorRef = useRef<any>(null);
  const store = useLogTableStore();
  useEffect(() => {
    store.register(TABLE_ID);
  }, [store]);
  return (
    <div style={{ maxWidth: 680, border: "1px solid #e5e7eb", borderRadius: 12, padding: 8 }}>
      <SandboxEditor
        initialContent={logTableContent()}
        onEditorReady={(editor) => {
          editorRef.current = editor;
        }}
      />
      <LogTableAddRecordLayer editorRef={editorRef} />
    </div>
  );
}

const meta: Meta = {
  title: "Features/LogTable",
  parameters: { layout: "padded" },
};
export default meta;

export const AddRecord: StoryObj = {
  name: "記録テーブル（+ 記録ボタン）",
  render: () => (
    <ErrorBoundary>
      <EditorProviders>
        <LogTableDemoInner />
      </EditorProviders>
    </ErrorBoundary>
  ),
};
