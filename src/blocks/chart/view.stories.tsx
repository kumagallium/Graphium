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
import { TableMetaStoreProvider } from "../../features/table-meta/store";
import { MediaInlineLabelProvider } from "../../features/inline-label/media-store";
import { BlockAlignmentProvider } from "../../features/block-alignment/store";
import { AiAssistantProvider } from "../../features/ai-assistant/store";
import type { ChartSeriesConfig } from "./chart-config";
import { primeAssetText } from "./asset-source";

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
              <BlockAlignmentProvider>
                <AiAssistantProvider aiAvailable={false}>{children}</AiAssistantProvider>
              </BlockAlignmentProvider>
            </MediaInlineLabelProvider>
          </TableMetaStoreProvider>
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

/**
 * XRD パターン想定のサンプル（2θ × 強度）。
 * ピークをガウス形で足して 10〜60° を 0.5° 刻みで作る。試料ごとに強度の桁を
 * 変えてあり、規格化しないと段の高さが揃わないことが見える。
 */
function xrdTable(id: string, peaks: Array<[number, number]>, background: number) {
  // Math.random だとストーリーを開くたび形が変わるので、決定的な擬似ノイズにする
  const noiseAt = (x: number) => {
    const v = Math.sin(x * 12.9898) * 43758.5453;
    return v - Math.floor(v);
  };
  const rows = [];
  for (let x = 10; x <= 60; x += 0.5) {
    let y = background * (0.8 + 0.4 * noiseAt(x));
    for (const [center, height] of peaks) {
      y += height * Math.exp(-((x - center) ** 2) / 0.6);
    }
    rows.push({ cells: [cell(x.toFixed(1)), cell(String(Math.round(y)))] });
  }
  return {
    id,
    type: "table",
    content: {
      type: "tableContent",
      rows: [{ cells: [cell("2θ (deg)"), cell("Intensity")] }, ...rows],
    },
  };
}

type DemoOptions = {
  extraTables?: any[];
  /** 既定の頭痛ダイアリーの代わりに置くテーブル群 */
  baseTables?: any[];
  lead?: string;
  /** チャートをテーブルより前に置く（XRD は行数が多く、後ろだと見るのに延々スクロールする） */
  chartFirst?: boolean;
};

function chartContent(config: Record<string, unknown>, opts: DemoOptions = {}) {
  const tables = [...(opts.baseTables ?? [diaryTable("diary-table-1")]), ...(opts.extraTables ?? [])];
  const chart = { type: "chart", props: { config: JSON.stringify(config) } };
  return [
    {
      type: "paragraph",
      content: cell(
        opts.lead ?? "頭痛ダイアリー（サンプル）。テーブルを編集するとチャートが追従する。"
      ),
    },
    ...(opts.chartFirst ? [chart, ...tables] : [...tables, chart]),
  ];
}

function ChartDemo({ config, ...opts }: { config: Record<string, unknown> } & DemoOptions) {
  return (
    <EditorProviders>
      <div style={{ maxWidth: 680, border: "1px solid #e5e7eb", borderRadius: 12, padding: 8 }}>
        <SandboxEditor blocks={[chartBlock]} initialContent={chartContent(config, opts)} />
      </div>
    </EditorProviders>
  );
}

/** XRD スタックのストーリー 3 本で共有する試料・文献パターン */
const XRD_TABLES = [
  // 測定試料: カウント数が数千
  xrdTable(
    "xrd-sample",
    [
      [22.5, 3000],
      [28.3, 8000],
      [31.7, 4500],
      [40.2, 2200],
      [47.8, 1800],
      [55.1, 1200],
    ],
    120
  ),
  // 文献 A: 同じ相。桁が 2 つ小さい（規格化しないと潰れる）
  xrdTable(
    "xrd-ref-a",
    [
      [22.5, 40],
      [28.3, 100],
      [31.7, 62],
      [40.2, 25],
      [47.8, 20],
      [55.1, 14],
    ],
    1
  ),
  // 文献 B: 別の相。ピーク位置が一部ずれ、22.5° の反射を持たない
  xrdTable(
    "xrd-ref-b",
    [
      [26.6, 90],
      [31.7, 30],
      [36.1, 55],
      [47.8, 18],
      [52.4, 40],
    ],
    2
  ),
];

const XRD_LEAD = "XRD の測定パターンと参考文献 2 件を 1 つの図に積んで比べる。";

/** 参考文献の回折線（スティック）: ピーク位置と相対強度だけのスパースな表 */
function xrdStickTable(id: string) {
  const peaks: Array<[number, number]> = [
    [21.4, 12],
    [25.8, 30],
    [33.2, 4],
    [40.1, 100],
    [43.4, 42],
    [48.0, 55],
    [53.6, 3],
    [55.7, 5],
    // 表示範囲（20〜60°）の外にも回折線が続く — 文献データではふつうのこと
    [64.2, 18],
    [71.9, 9],
  ];
  return {
    id,
    type: "table",
    content: {
      type: "tableContent",
      rows: [
        { cells: [cell("2theta"), cell("I")] },
        ...peaks.map(([x, y]) => ({ cells: [cell(x.toFixed(1)), cell(String(y))] })),
      ],
    },
  };
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

// 系列スタイル: 線の種類・太さ・マーカーを系列ごとに変える（白黒印刷でも
// 系列を区別できる、論文図の描き分け）
export const SeriesStyles: StoryObj = {
  name: "系列スタイル（線種・太さ・マーカー）",
  render: () => (
    <ErrorBoundary>
      <ChartDemo
        config={{
          chartType: "line",
          series: series([
            {
              sourceBlockId: "diary-table-1",
              xColumn: "日時",
              yColumn: "痛み",
              lineWidth: "thick",
              symbol: "emptyCircle",
              symbolSize: "large",
            },
            {
              sourceBlockId: "diary-table-1",
              xColumn: "日時",
              yColumn: "薬(錠)",
              lineType: "dashed",
              lineWidth: "thin",
              showSymbol: false,
            },
            {
              sourceBlockId: "diary-table-1",
              xColumn: "日時",
              yColumn: "気圧",
              axis: "right",
              lineType: "dotted",
              symbol: "emptyTriangle",
            },
          ]),
          yMin: "0",
          yMax: "10",
          caption: "系列ごとに線の種類・太さ・マーカーを変えた例",
        }}
      />
    </ErrorBoundary>
  ),
};

// 棒の見た目: 幅を広げて積み上げる（同じ軸の棒系列が 1 本に積まれる）
export const StackedBars: StoryObj = {
  name: "棒（幅・積み上げ）",
  render: () => (
    <ErrorBoundary>
      <ChartDemo
        config={{
          chartType: "bar",
          series: series([
            {
              sourceBlockId: "diary-table-1",
              xColumn: "日時",
              yColumn: "痛み",
              barWidth: "wide",
              stacked: true,
            },
            {
              sourceBlockId: "diary-table-1",
              xColumn: "日時",
              yColumn: "薬(錠)",
              barWidth: "wide",
              stacked: true,
            },
          ]),
          caption: "頭痛強度と服薬数を積み上げた例",
        }}
      />
    </ErrorBoundary>
  ),
};

// 複合: 棒（服薬数）に折れ線（痛み）を重ねる。系列ごとの「種類」で切り替える
export const BarLineCombo: StoryObj = {
  name: "複合（棒 + 折れ線）",
  render: () => (
    <ErrorBoundary>
      <ChartDemo
        config={{
          chartType: "bar",
          series: series([
            { sourceBlockId: "diary-table-1", xColumn: "日時", yColumn: "薬(錠)" },
            {
              sourceBlockId: "diary-table-1",
              xColumn: "日時",
              yColumn: "痛み",
              type: "line",
              axis: "right",
            },
          ]),
          yRightMin: "0",
          yRightMax: "10",
          caption: "服薬数（棒）に頭痛強度（折れ線・右軸）を重ねた例",
        }}
      />
    </ErrorBoundary>
  ),
};

// 棒 × 数値 X 軸: 種類で「数値」を選ぶとカテゴリ軸を離れ、範囲も指定できる
export const BarValueAxis: StoryObj = {
  name: "棒（数値 X 軸・範囲指定）",
  render: () => (
    <ErrorBoundary>
      <ChartDemo
        config={{
          chartType: "bar",
          series: series([{ sourceBlockId: "diary-table-1", xColumn: "気圧", yColumn: "痛み" }]),
          xAxisKind: "value",
          xMin: "995",
          xMax: "1020",
          caption: "気圧（数値軸・995〜1020 hPa に固定）ごとの頭痛強度",
        }}
      />
    </ErrorBoundary>
  ),
};

// 複合 × 積み重ね: 測定パターン（折れ線）と参考文献の回折線（棒）を積む。
// XRD で文献をスティックで描く定番の形
export const XrdStackWithSticks: StoryObj = {
  name: "積み重ね × 複合（測定は折れ線・文献は棒）",
  render: () => (
    <ErrorBoundary>
      <ChartDemo
        baseTables={[XRD_TABLES[0], xrdStickTable("xrd-stick")]}
        lead={XRD_LEAD}
        chartFirst
        config={{
          chartType: "line",
          series: series([
            {
              sourceBlockId: "xrd-sample",
              xColumn: "2θ (deg)",
              yColumn: "Intensity",
              label: "測定値",
            },
            {
              sourceBlockId: "xrd-stick",
              xColumn: "2theta",
              yColumn: "I",
              label: "ref",
              type: "bar",
            },
          ]),
          stack: { enabled: true, normalize: "max", gap: 1.15, order: "first-top", labels: "inline" },
          xMin: "20",
          xMax: "60",
          aspect: "wide",
          xAxisName: "2θ (deg)",
          yAxisName: "Intensity (a.u.)",
        }}
      />
    </ErrorBoundary>
  ),
};

// 並ぶ向きを逆にした形。棒は 0 起点でしか描けないので、段の土台を敷かないと
// 上段に来た棒が枠の下端まで伸びてしまう（回帰の見張り）
// 複合 × 積み重ね: 測定パターン（折れ線）と参考文献の回折線（棒）を積む。
// XRD で文献をスティックで描く定番の形
export const XrdStackWithSticksFirstBottom: StoryObj = {
  name: "積み重ね × 複合（1 番目を下に）",
  render: () => (
    <ErrorBoundary>
      <ChartDemo
        baseTables={[XRD_TABLES[0], xrdStickTable("xrd-stick")]}
        lead={XRD_LEAD}
        chartFirst
        config={{
          chartType: "line",
          series: series([
            {
              sourceBlockId: "xrd-sample",
              xColumn: "2θ (deg)",
              yColumn: "Intensity",
              label: "測定値",
            },
            {
              sourceBlockId: "xrd-stick",
              xColumn: "2theta",
              yColumn: "I",
              label: "ref",
              type: "bar",
            },
          ]),
          stack: { enabled: true, normalize: "max", gap: 1.15, order: "first-bottom", labels: "inline" },
          xMin: "20",
          xMax: "60",
          aspect: "wide",
          xAxisName: "2θ (deg)",
          yAxisName: "Intensity (a.u.)",
        }}
      />
    </ErrorBoundary>
  ),
};

// 未設定: テーブル選択プレースホルダ（スラッシュメニュー挿入直後の状態）
// スタック: XRD の測定 + 文献 2 件。強度の桁が違っても規格化で段の高さが揃う
export const XrdStack: StoryObj = {
  name: "積み重ね（XRD の測定 × 文献 2 件）",
  render: () => (
    <ErrorBoundary>
      <ChartDemo
        baseTables={XRD_TABLES}
        lead={XRD_LEAD}
        chartFirst
        config={{
          chartType: "line",
          series: series([
            { sourceBlockId: "xrd-sample", xColumn: "2θ (deg)", yColumn: "Intensity", label: "測定試料" },
            { sourceBlockId: "xrd-ref-a", xColumn: "2θ (deg)", yColumn: "Intensity", label: "文献 A" },
            { sourceBlockId: "xrd-ref-b", xColumn: "2θ (deg)", yColumn: "Intensity", label: "文献 B" },
          ]),
          stack: { enabled: true, normalize: "max", gap: 1.15, order: "first-bottom", labels: "inline" },
          xMin: "10",
          xMax: "60",
          aspect: "wide",
          xAxisName: "2θ (deg)",
          yAxisName: "Intensity (a.u.)",
          caption: "測定パターンと参考文献の比較",
        }}
      />
    </ErrorBoundary>
  ),
};

// 系列ごとの倍率・段位置調整: 弱いパターンを ×3 して読めるようにする
export const XrdStackAdjusted: StoryObj = {
  name: "積み重ね（倍率 ×3 と段位置の調整）",
  render: () => (
    <ErrorBoundary>
      <ChartDemo
        baseTables={XRD_TABLES}
        lead={XRD_LEAD}
        chartFirst
        config={{
          chartType: "line",
          series: series([
            { sourceBlockId: "xrd-sample", xColumn: "2θ (deg)", yColumn: "Intensity", label: "測定試料" },
            // 段の位置を少しだけ持ち上げて、下の段の高いピークから逃がす
            {
              sourceBlockId: "xrd-ref-a",
              xColumn: "2θ (deg)",
              yColumn: "Intensity",
              label: "文献 A",
              offsetAdjust: 0.15,
            },
            // 微弱なパターンを拡大する。拡大するなら上が空いている最上段に置く
            {
              sourceBlockId: "xrd-ref-b",
              xColumn: "2θ (deg)",
              yColumn: "Intensity",
              label: "文献 B (×3)",
              scale: 3,
            },
          ]),
          stack: { enabled: true, normalize: "max", gap: 1.15, order: "first-bottom", labels: "inline" },
          xMin: "10",
          xMax: "60",
          aspect: "wide",
          xAxisName: "2θ (deg)",
          yAxisName: "Intensity (a.u.)",
        }}
      />
    </ErrorBoundary>
  ),
};

// 段ラベルを凡例に出す版（既定の inline との比較用）
export const XrdStackLegendLabels: StoryObj = {
  name: "積み重ね（段の名前を凡例に）",
  render: () => (
    <ErrorBoundary>
      <ChartDemo
        baseTables={XRD_TABLES}
        lead={XRD_LEAD}
        chartFirst
        config={{
          chartType: "line",
          series: series([
            { sourceBlockId: "xrd-sample", xColumn: "2θ (deg)", yColumn: "Intensity", label: "測定試料" },
            { sourceBlockId: "xrd-ref-a", xColumn: "2θ (deg)", yColumn: "Intensity", label: "文献 A" },
            { sourceBlockId: "xrd-ref-b", xColumn: "2θ (deg)", yColumn: "Intensity", label: "文献 B" },
          ]),
          stack: { enabled: true, normalize: "max", gap: 1.15, order: "first-top", labels: "legend" },
          xMin: "10",
          xMax: "60",
          aspect: "wide",
          yAxisName: "Intensity (a.u.)",
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

// ── 素材のデータを参照先にする ──
// 素材の実体はプロバイダの向こうにあるので、ストーリーでは本文をキャッシュに先出し
// しておく（primeAssetText）。読み方（options）はチャート設定側が持つ。
const REF_ASSET_ID = "story-asset-ref-a";
const REF_ASSET_TEXT = (() => {
  // 装置出力風: 前置き 2 行 + タブ区切りの見出し + データ行（10〜60°）
  const lines = ["# Device Model: XRD-STORY", "# Scan: 10-60 deg"];
  lines.push("2theta\tI");
  const peaks: Array<[number, number]> = [[22.5, 40], [28.3, 100], [31.7, 62], [40.2, 25], [47.8, 20], [55.1, 14]];
  for (let x = 10; x <= 60; x += 0.5) {
    let y = 1;
    for (const [c, h] of peaks) y += h * Math.exp(-((x - c) ** 2) / 0.6);
    lines.push(`${x.toFixed(1)}\t${Math.round(y)}`);
  }
  return lines.join("\n");
})();
const REF_ASSET_OPTIONS = { headerRow: 3, endRow: 104, delimiter: "tab" as const, collapseConsecutive: false };

// 測定はノート内テーブル、文献パターンは素材（別のノートに表を置かずに重ねる形）
export const AssetSourceStack: StoryObj = {
  name: "素材のデータを重ねる（測定＝表・文献＝素材）",
  render: () => {
    primeAssetText(REF_ASSET_ID, REF_ASSET_TEXT);
    return (
      <ErrorBoundary>
        <ChartDemo
          baseTables={[XRD_TABLES[0]]}
          lead="測定パターンはこのノートの表、参考文献のパターンは素材（データ）から直接読んで重ねる。"
          chartFirst
          config={{
            chartType: "line",
            series: series([
              { sourceBlockId: "xrd-sample", xColumn: "2θ (deg)", yColumn: "Intensity", label: "測定試料" },
              { sourceBlockId: `asset:${REF_ASSET_ID}`, xColumn: "2theta", yColumn: "I" },
            ]),
            assetSources: [{ fileId: REF_ASSET_ID, fileName: "ref-pattern-A.txt", options: REF_ASSET_OPTIONS }],
            stack: { enabled: true, normalize: "max", gap: 1.15, order: "first-bottom", labels: "inline" },
            xMin: "10",
            xMax: "60",
            aspect: "wide",
            xAxisName: "2θ (deg)",
            yAxisName: "Intensity (a.u.)",
            caption: "測定パターンと素材の文献パターン（段名は素材名）",
          }}
        />
      </ErrorBoundary>
    );
  },
};

// 素材が消えた（読めない）: 素材だけを参照する図は「参照先の素材が見つかりません」
export const AssetSourceGone: StoryObj = {
  name: "素材のデータが見つからない",
  render: () => (
    <ErrorBoundary>
      <ChartDemo
        baseTables={[]}
        lead="参照していた素材が削除された（実体を読めない）ときの表示。"
        config={{
          chartType: "line",
          series: series([{ sourceBlockId: "asset:story-asset-missing", xColumn: "2theta", yColumn: "I" }]),
          assetSources: [
            { fileId: "story-asset-missing", fileName: "deleted.dat", options: REF_ASSET_OPTIONS },
          ],
        }}
      />
    </ErrorBoundary>
  ),
};
