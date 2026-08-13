// 記録テーブルのストーリー
// - 標準の行追加（テーブル下端の + 帯・最終セルで Tab）で行を足すと、
//   1 列目に現在日時が自動で入ることを目視確認する（専用ボタンは無い）
// - テーブル上のキャプション（名前）表示・クリック編集を確認する

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
import { LogTableCaptionLayer } from "./caption-layer";
import { applyLogTableTimestamps, resetLogTableRowTracking } from "./auto-timestamp";
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
      content: cell(
        "記録テーブル。テーブル下端の + や最終セルで Tab を押して行を足すと、日時が自動で入る。"
      ),
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

// LogTableStoreProvider の内側で register・自動日時・キャプション層を配線するデモ本体
function LogTableDemoInner() {
  const editorRef = useRef<any>(null);
  const store = useLogTableStore();
  const storeRef = useRef(store);
  storeRef.current = store;
  useEffect(() => {
    resetLogTableRowTracking();
    store.register(TABLE_ID);
    store.setName(TABLE_ID, "頭痛ダイアリー");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div style={{ maxWidth: 680, border: "1px solid #e5e7eb", borderRadius: 12, padding: "28px 8px 8px" }}>
      <SandboxEditor
        initialContent={logTableContent()}
        onEditorReady={(editor) => {
          editorRef.current = editor;
        }}
        onChange={() => {
          applyLogTableTimestamps(editorRef.current, storeRef.current.tables.keys());
        }}
      />
      <LogTableCaptionLayer editorRef={editorRef} />
    </div>
  );
}

const meta: Meta = {
  title: "Features/LogTable",
  parameters: { layout: "padded" },
};
export default meta;

export const AutoTimestamp: StoryObj = {
  name: "記録テーブル（自動日時+キャプション）",
  render: () => (
    <ErrorBoundary>
      <EditorProviders>
        <LogTableDemoInner />
      </EditorProviders>
    </ErrorBoundary>
  ),
};
