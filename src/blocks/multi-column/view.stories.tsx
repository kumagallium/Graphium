// マルチカラム（columnList / column）のストーリー
// 目視・操作確認の観点:
//   - 2 カラム / 3 カラムの描画と、既存ブロック（表・画像・step）のカラム内配置
//   - カラム境界のドラッグで幅リサイズ（cursor: col-resize が出るか）
//   - 狭い枠では flex-wrap で縦積みになるか（SidePeek 320px 相当）
//   - カラム内ブロックのドラッグハンドル位置（core の SideMenu 補正が効くか）

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Component, type ReactNode } from "react";
import { SandboxEditor } from "../../base/editor";
import { columnListBlock, columnBlock, columnsSlashItem } from "./index";
import { stepBlock } from "../step";
// カラムの flex レイアウトは app.css にある
import "../../app.css";
import {
  LabelStoreProvider,
  ProvLabelsEnabledProvider,
} from "../../features/context-label/store";
import { LinkStoreProvider } from "../../features/block-link/store";
import { TableMetaStoreProvider } from "../../features/table-meta/store";
import { MediaInlineLabelProvider } from "../../features/inline-label/media-store";
import { BlockAlignmentProvider } from "../../features/block-alignment/store";
import { AiAssistantProvider } from "../../features/ai-assistant/store";

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
        <div style={{ padding: 16, color: "#c26356", fontSize: 13 }}>
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

function EditorProviders({ children }: { children: ReactNode }) {
  return (
    <ProvLabelsEnabledProvider enabled={false}>
      <LabelStoreProvider>
        <LinkStoreProvider>
          <TableMetaStoreProvider>
            <MediaInlineLabelProvider>
              <BlockAlignmentProvider>
                <AiAssistantProvider aiAvailable={false}>
                  {children}
                </AiAssistantProvider>
              </BlockAlignmentProvider>
            </MediaInlineLabelProvider>
          </TableMetaStoreProvider>
        </LinkStoreProvider>
      </LabelStoreProvider>
    </ProvLabelsEnabledProvider>
  );
}

const p = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text, styles: {} }],
});

// 毎回まっさらな initialContent を返す（BlockNote が編集で変異させるため共有しない）
function twoColumnContent() {
  return [
    p("カラムの前の段落。境界（カラムの隙間）をドラッグすると幅を変えられる。"),
    {
      type: "columnList",
      children: [
        {
          type: "column",
          children: [
            { type: "heading", props: { level: 2 }, content: [{ type: "text", text: "観察", styles: {} }] },
            p("左カラム。ここに本文を書く。"),
            p("Backspace / Delete でのカラム間移動は BlockNote core の挙動がそのまま乗る。"),
          ],
        },
        {
          type: "column",
          children: [
            { type: "heading", props: { level: 2 }, content: [{ type: "text", text: "考察", styles: {} }] },
            p("右カラム。表も入る:"),
            {
              type: "table",
              content: {
                type: "tableContent",
                rows: [
                  { cells: [[{ type: "text", text: "条件", styles: {} }], [{ type: "text", text: "値", styles: {} }]] },
                  { cells: [[{ type: "text", text: "温度", styles: {} }], [{ type: "text", text: "60°C", styles: {} }]] },
                ],
              },
            },
          ],
        },
      ],
    },
    p("カラムの後の段落。"),
  ];
}

function threeColumnContent() {
  return [
    {
      type: "columnList",
      children: [
        { type: "column", children: [p("1 列目")] },
        { type: "column", props: { width: 2 }, children: [p("2 列目（width: 2 で倍幅）")] },
        { type: "column", children: [p("3 列目")] },
      ],
    },
  ];
}

function ColumnsDemo({ width, content }: { width: number; content?: any[] }) {
  return (
    <EditorProviders>
      <div
        style={{
          maxWidth: width,
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 8,
        }}
      >
        <SandboxEditor
          blocks={[columnListBlock, columnBlock, stepBlock]}
          extraSlashMenuItems={[columnsSlashItem]}
          initialContent={content ?? twoColumnContent()}
        />
      </div>
    </EditorProviders>
  );
}

const meta: Meta = {
  title: "Blocks/MultiColumn",
  parameters: { layout: "padded" },
};
export default meta;

export const TwoColumns: StoryObj = {
  name: "2 カラム（見出し・表入り）",
  render: () => (
    <Safe>
      <ColumnsDemo width={680} />
    </Safe>
  ),
};

export const ThreeColumns: StoryObj = {
  name: "3 カラム（width 比率 1:2:1）",
  render: () => (
    <Safe>
      <ColumnsDemo width={680} content={threeColumnContent()} />
    </Safe>
  ),
};

export const NarrowContainer: StoryObj = {
  name: "狭い枠（SidePeek 320px 相当・縦積み）",
  render: () => (
    <Safe>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>
        カラムの min-width（220px）を並べられない幅では flex-wrap で
        自動的に縦積みになる。メディアクエリではなくコンテナ幅で決まるので、
        デスクトップの SidePeek でも同じ挙動になる。
      </div>
      <ColumnsDemo width={320} />
    </Safe>
  ),
};

export const SlashInsert: StoryObj = {
  name: "スラッシュメニューから挿入（/カラム）",
  render: () => (
    <Safe>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>
        本文で「/カラム」または「/columns」と打つと 2 カラムを挿入できる。
      </div>
      <ColumnsDemo width={680} content={[p("ここで / を打って「カラム」を選ぶ。")]} />
    </Safe>
  ),
};

export const DragToColumns: StoryObj = {
  name: "ドラッグ&ドロップでカラム生成",
  render: () => (
    <Safe>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>
        ブロックをハンドル（⠿）で掴んで別ブロックの<b>左右端</b>に落とすと
        2 カラムになる（縦のドロップカーソルが出る）。既存カラムの左右端や
        カラム間の隙間に落とすと、そこに新しいカラムが増える。
      </div>
      <ColumnsDemo
        width={680}
        content={[
          p("このブロックを下のブロックの右端にドラッグしてみる。"),
          p("ドロップ先のブロック。右端 20% が「カラム化ゾーン」。"),
          p("こちらは既存カラムの端に落とす実験用:"),
          {
            type: "columnList",
            children: [
              { type: "column", children: [p("左カラム")] },
              { type: "column", children: [p("右カラム")] },
            ],
          },
        ]}
      />
    </Safe>
  ),
};
