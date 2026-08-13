// テーブル注釈のストーリー
// - 日時が入る列を持つテーブル: 標準の行追加（テーブル下端の + 帯・最終セルで Tab）で
//   行を足すと 1 列目に現在日時が自動で入ることを目視確認する（専用ボタンは無い）
// - キャプション（テーブルの名前）は、はたらきの付いていないふつうのテーブルにも
//   付けられる。名前が無いテーブルには何も出ない（付ける入口は ⠿ メニュー）

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Component, useEffect, useRef, type ReactNode } from "react";
import { SandboxEditor } from "../../base/editor";
import "../../app.css";
import {
  LabelStoreProvider,
  ProvLabelsEnabledProvider,
} from "../context-label/store";
import { LinkStoreProvider } from "../block-link/store";
import { TableMetaStoreProvider, useTableMetaStore } from "./store";
import { TableCaptionLayer } from "./caption-layer";
import {
  applyLogTableTimestamps,
  primeLogTableRowTracking,
  resetLogTableRowTracking,
} from "../log-table/auto-timestamp";
import { MediaInlineLabelProvider } from "../inline-label/media-store";
import { MediaOcrProvider } from "../media-ocr/store";
import { BlockAlignmentProvider } from "../block-alignment/store";
import { AiAssistantProvider } from "../ai-assistant/store";
import { NoteSideMenu } from "../../components/side-menu";

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
          <TableMetaStoreProvider>
            <MediaInlineLabelProvider>
              <MediaOcrProvider>
                <BlockAlignmentProvider>
                  <AiAssistantProvider aiAvailable={false}>{children}</AiAssistantProvider>
                </BlockAlignmentProvider>
              </MediaOcrProvider>
            </MediaInlineLabelProvider>
          </TableMetaStoreProvider>
        </LinkStoreProvider>
      </LabelStoreProvider>
    </ProvLabelsEnabledProvider>
  );
}

const cell = (text: string) => [{ type: "text", text, styles: {} }];

const TABLE_ID = "table-meta-demo";

function tableContent(lead: string, headers: string[], firstRow: string[]) {
  return [
    { type: "paragraph", content: cell(lead) },
    {
      id: TABLE_ID,
      type: "table",
      content: {
        type: "tableContent",
        rows: [{ cells: headers.map(cell) }, { cells: firstRow.map(cell) }],
      },
    },
    { type: "paragraph", content: cell("テーブルの後ろの段落。") },
  ];
}

/** TableMetaStoreProvider の内側で注釈・自動日時・キャプション層を配線するデモ本体 */
function TableMetaDemoInner({
  content,
  datetimeColumn,
  caption,
}: {
  content: any[];
  /** 日時が自動で入る列の名前。null なら付けない（ふつうのテーブル） */
  datetimeColumn: string | null;
  caption: string;
}) {
  const editorRef = useRef<any>(null);
  const store = useTableMetaStore();
  const storeRef = useRef(store);
  storeRef.current = store;
  useEffect(() => {
    resetLogTableRowTracking();
    if (datetimeColumn !== null) {
      store.addColumnType(TABLE_ID, datetimeColumn, "datetime-auto");
      // 実アプリはノート読み込み時に行数を記録する。ここでも同じ状態にしないと
      // 最初の行追加が「初見」扱いになり、日時が入らない
      primeLogTableRowTracking(content, [TABLE_ID]);
    }
    if (caption) store.setCaption(TABLE_ID, caption);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div style={{ maxWidth: 680, border: "1px solid #e5e7eb", borderRadius: 12, padding: "28px 8px 8px" }}>
      <SandboxEditor
        initialContent={content}
        // ⠿ メニューの「テーブルに名前を付ける」も同じ場所で確認できるようにする
        sideMenu={NoteSideMenu}
        onEditorReady={(editor) => {
          editorRef.current = editor;
        }}
        onChange={() => {
          applyLogTableTimestamps(
            editorRef.current,
            storeRef.current.blockIdsWithColumnType("datetime-auto")
          );
        }}
      />
      <TableCaptionLayer editorRef={editorRef} />
    </div>
  );
}

const meta: Meta = {
  title: "Features/TableMeta",
  parameters: { layout: "padded" },
};
export default meta;

export const AutoTimestamp: StoryObj = {
  name: "日時が自動で入るテーブル（名前つき）",
  render: () => (
    <ErrorBoundary>
      <EditorProviders>
        <TableMetaDemoInner
          content={tableContent(
            "時系列テーブル。テーブル下端の + や最終セルで Tab を押して行を足すと、日時が自動で入る。",
            ["日時", "値", "メモ"],
            ["2026-08-11 08:15", "7", "台風"]
          )}
          datetimeColumn="日時"
          caption="頭痛ダイアリー"
        />
      </EditorProviders>
    </ErrorBoundary>
  ),
};

export const PlainTableWithCaption: StoryObj = {
  name: "名前を付けただけのふつうのテーブル",
  render: () => (
    <ErrorBoundary>
      <EditorProviders>
        <TableMetaDemoInner
          content={tableContent(
            "はたらきの付いていないふつうのテーブルにも名前を付けられる。自動番号（表 N）は振らず、付けた名前だけが出る。",
            ["試料", "組成", "備考"],
            ["A-1", "Fe0.8Co0.2", "再現性あり"]
          )}
          datetimeColumn={null}
          caption="試料の一覧"
        />
      </EditorProviders>
    </ErrorBoundary>
  ),
};

export const PlainTableWithoutCaption: StoryObj = {
  name: "名前の無いふつうのテーブル（何も出ない）",
  render: () => (
    <ErrorBoundary>
      <EditorProviders>
        <TableMetaDemoInner
          content={tableContent(
            "名前もはたらきも無いテーブルには、表の上に何も出ない。付ける入口は ⠿ メニューの「テーブルに名前を付ける」。",
            ["項目", "値"],
            ["密度", "7.87"]
          )}
          datetimeColumn={null}
          caption=""
        />
      </EditorProviders>
    </ErrorBoundary>
  ),
};
