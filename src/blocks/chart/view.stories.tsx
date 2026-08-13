// チャートブロックのストーリー
// 記録テーブル（頭痛ダイアリー想定のサンプルデータ）を参照して描画する様子と、
// 複数テーブルの重ね描き・テーブル未選択のプレースホルダを目視確認する。

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
import type { ChartSeriesConfig } from "./chart-config";

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

/** 別テーブル: 睡眠ログ（複数テーブル重ね描きのデモ用） */
function sleepTable(id: string) {
  return {
    id,
    type: "table",
    content: {
      type: "tableContent",
      rows: [
        { cells: [cell("日時"), cell("睡眠(h)")] },
        { cells: [cell("2026-08-05 08:00"), cell("7.5")] },
        { cells: [cell("2026-08-06 07:30"), cell("4.5")] },
        { cells: [cell("2026-08-07 21:00"), cell("7")] },
        { cells: [cell("2026-08-08 09:10"), cell("6")] },
        { cells: [cell("2026-08-09 08:15"), cell("5")] },
        { cells: [cell("2026-08-10 10:00"), cell("6.5")] },
        { cells: [cell("2026-08-11 07:45"), cell("8")] },
      ],
    },
  };
}

function chartContent(config: Record<string, unknown>, extraTables: any[] = []) {
  return [
    {
      type: "paragraph",
      content: cell("頭痛ダイアリー（サンプル）。テーブルを編集するとチャートが追従する。"),
    },
    diaryTable("diary-table-1"),
    ...extraTables,
    { type: "chart", props: { config: JSON.stringify(config) } },
  ];
}

function ChartDemo({
  config,
  extraTables,
}: {
  config: Record<string, unknown>;
  extraTables?: any[];
}) {
  return (
    <EditorProviders>
      <div style={{ maxWidth: 680, border: "1px solid #e5e7eb", borderRadius: 12, padding: 8 }}>
        <SandboxEditor blocks={[chartBlock]} initialContent={chartContent(config, extraTables)} />
      </div>
    </EditorProviders>
  );
}

const series = (list: ChartSeriesConfig[]) => list;

const meta: Meta = {
  title: "Blocks/ChartBlock",
  parameters: { layout: "padded" },
};
export default meta;

// 折れ線: 日時 × 痛みの時系列 + キャプション（学術スタイルの基本形）
export const Line: StoryObj = {
  name: "折れ線（日時 × 痛み、キャプション付き）",
  render: () => (
    <ErrorBoundary>
      <ChartDemo
        config={{
          chartType: "line",
          series: series([
            { sourceBlockId: "diary-table-1", xColumn: "日時", yColumn: "痛み" },
          ]),
          caption: "8月上旬の頭痛強度の推移",
        }}
      />
    </ErrorBoundary>
  ),
};

// 2 系列 + 第 2 軸: 痛み（左軸 0-10）と気圧（右軸 ~1000 hPa）
export const TwoSeriesDualAxis: StoryObj = {
  name: "2 系列・2 軸（痛み左・気圧右）",
  render: () => (
    <ErrorBoundary>
      <ChartDemo
        config={{
          chartType: "line",
          series: series([
            { sourceBlockId: "diary-table-1", xColumn: "日時", yColumn: "痛み" },
            { sourceBlockId: "diary-table-1", xColumn: "日時", yColumn: "気圧", axis: "right" },
          ]),
          yMin: "0",
          yMax: "10",
          caption: "頭痛強度と気圧の推移",
        }}
      />
    </ErrorBoundary>
  ),
};

// 複数テーブルの重ね描き: 頭痛ダイアリー + 睡眠ログ（eureco の複数ソース統合）
export const TwoTables: StoryObj = {
  name: "2 テーブル重ね（痛み × 睡眠ログ）",
  render: () => (
    <ErrorBoundary>
      <ChartDemo
        extraTables={[sleepTable("sleep-table-1")]}
        config={{
          chartType: "line",
          series: series([
            { sourceBlockId: "diary-table-1", xColumn: "日時", yColumn: "痛み" },
            {
              sourceBlockId: "sleep-table-1",
              xColumn: "日時",
              yColumn: "睡眠(h)",
              axis: "right",
              type: "bar",
            },
          ]),
          yMin: "0",
          yMax: "10",
          caption: "頭痛強度と睡眠時間 — 別テーブルからの重ね描き",
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
        config={{
          chartType: "histogram",
          series: series([
            { sourceBlockId: "diary-table-1", xColumn: "", yColumn: "痛み" },
          ]),
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
        config={{
          chartType: "scatter",
          series: series([
            { sourceBlockId: "diary-table-1", xColumn: "気圧", yColumn: "痛み" },
          ]),
          showGridX: true,
          showGridY: true,
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
        config={{
          chartType: "line",
          series: series([
            { sourceBlockId: "diary-table-1", xColumn: "日時", yColumn: "痛み" },
            { sourceBlockId: "diary-table-1", xColumn: "日時", yColumn: "薬(錠)" },
          ]),
          legendPosition: "inside-top-right",
          legendOrient: "vertical",
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
      <ChartDemo config={{}} />
    </ErrorBoundary>
  ),
};
