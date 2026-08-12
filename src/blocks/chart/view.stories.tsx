// チャートブロックのストーリー
// 記録テーブル（頭痛ダイアリー想定のサンプルデータ）を参照して描画する様子と、
// テーブル未選択のプレースホルダを目視確認する。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Component, type ReactNode } from "react";
import { SandboxEditor } from "../../base/editor";
import { chartBlock } from "./index";
import "../../app.css";
// SandboxEditor は note-app と同じ Context 群を要求する（step のストーリーと同じ理由）
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

/** 頭痛ダイアリー想定のサンプル記録テーブル（id 固定でチャートから参照する） */
function diaryTable(id: string) {
  return {
    id,
    type: "table",
    content: {
      type: "tableContent",
      rows: [
        { cells: [cell("日時"), cell("痛み"), cell("薬(錠)"), cell("気圧"), cell("メモ")] },
        { cells: [cell("2026-08-05 08:00"), cell("2"), cell("0"), cell("1015"), cell("")] },
        { cells: [cell("2026-08-06 07:30"), cell("6"), cell("1"), cell("1008"), cell("寝不足")] },
        { cells: [cell("2026-08-07 21:00"), cell("3"), cell("0"), cell("1013"), cell("")] },
        { cells: [cell("2026-08-08 09:10"), cell("4"), cell("1"), cell("1010"), cell("")] },
        { cells: [cell("2026-08-09 08:15"), cell("7"), cell("2"), cell("998"), cell("台風接近")] },
        { cells: [cell("2026-08-10 10:00"), cell("5"), cell("1"), cell("1002"), cell("")] },
        { cells: [cell("2026-08-11 07:45"), cell("2"), cell("0"), cell("1012"), cell("")] },
      ],
    },
  };
}

function chartContent(props: Record<string, string>) {
  return [
    {
      type: "paragraph",
      content: cell("頭痛ダイアリー（サンプル）。テーブルを編集するとチャートが追従する。"),
    },
    diaryTable("diary-table-1"),
    { type: "chart", props },
  ];
}

function ChartDemo({ props }: { props: Record<string, string> }) {
  return (
    <EditorProviders>
      <div style={{ maxWidth: 680, border: "1px solid #e5e7eb", borderRadius: 12, padding: 8 }}>
        <SandboxEditor blocks={[chartBlock]} initialContent={chartContent(props)} />
      </div>
    </EditorProviders>
  );
}

const meta: Meta = {
  title: "Blocks/ChartBlock",
  parameters: { layout: "padded" },
};
export default meta;

const config = (patch: Record<string, unknown>) => JSON.stringify(patch);

// 折れ線: 日時 × 痛みの時系列 + キャプション（学術スタイルの基本形）
export const Line: StoryObj = {
  name: "折れ線（日時 × 痛み、キャプション付き）",
  render: () => (
    <ErrorBoundary>
      <ChartDemo
        props={{
          sourceBlockId: "diary-table-1",
          config: config({
            chartType: "line",
            xColumn: "日時",
            yColumns: ["痛み"],
            caption: "8月上旬の頭痛強度の推移",
          }),
        }}
      />
    </ErrorBoundary>
  ),
};

// 2 系列 + 第 2 軸: 痛み（左軸 0-10）と気圧（右軸 ~1000 hPa）。
// スケールの違う 2 系列を重ねる、頭痛ダイアリーの本命ユースケース
export const TwoSeriesDualAxis: StoryObj = {
  name: "2 系列・2 軸（痛み左・気圧右）",
  render: () => (
    <ErrorBoundary>
      <ChartDemo
        props={{
          sourceBlockId: "diary-table-1",
          config: config({
            chartType: "line",
            xColumn: "日時",
            yColumns: ["痛み", "気圧"],
            seriesOptions: { 気圧: { axis: "right" } },
            yMin: "0",
            yMax: "10",
            caption: "頭痛強度と気圧の推移",
          }),
        }}
      />
    </ErrorBoundary>
  ),
};

// 凡例をグラフ内（右上）に置き、縦に並べる
export const InsideLegend: StoryObj = {
  name: "凡例をグラフ内（右上・縦）",
  render: () => (
    <ErrorBoundary>
      <ChartDemo
        props={{
          sourceBlockId: "diary-table-1",
          config: config({
            chartType: "line",
            xColumn: "日時",
            yColumns: ["痛み", "薬(錠)"],
            legendPosition: "inside-top-right",
            legendOrient: "vertical",
          }),
        }}
      />
    </ErrorBoundary>
  ),
};

// 分布: 痛みのヒストグラム（ビン連続・白区切り）
export const Histogram: StoryObj = {
  name: "分布（痛みのヒストグラム）",
  render: () => (
    <ErrorBoundary>
      <ChartDemo
        props={{
          sourceBlockId: "diary-table-1",
          config: config({ chartType: "histogram", xColumn: "痛み" }),
        }}
      />
    </ErrorBoundary>
  ),
};

// 散布図: 気圧 × 痛み（相関を見る）+ グリッド線オン
export const Scatter: StoryObj = {
  name: "散布図（気圧 × 痛み、グリッド線）",
  render: () => (
    <ErrorBoundary>
      <ChartDemo
        props={{
          sourceBlockId: "diary-table-1",
          config: config({
            chartType: "scatter",
            xColumn: "気圧",
            yColumns: ["痛み"],
            showGrid: true,
          }),
        }}
      />
    </ErrorBoundary>
  ),
};

// 未設定: テーブル選択プレースホルダ（スラッシュメニュー挿入直後の状態）
export const Placeholder: StoryObj = {
  name: "未設定（テーブル選択）",
  render: () => (
    <ErrorBoundary>
      <ChartDemo props={{ sourceBlockId: "" }} />
    </ErrorBoundary>
  ),
};
