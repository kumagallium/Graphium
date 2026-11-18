// データ表ブロックのストーリー
// パン作り想定のオーブン温度ログ（決定的に生成した CSV）を素材として参照し、
// 大量行の仮想スクロール・少数行・素材切れ（参照先が無い）の 3 パターンを確認する。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Component, type ReactNode } from "react";
import { SandboxEditor } from "../../base/editor";
import { dataTableBlock } from "./index";
import { serializeDataTableSource } from "./model";
import "../../app.css";
// SandboxEditor は note-app と同じ Context 群を要求する（chart のストーリーと同じ理由）
import {
  LabelStoreProvider,
  ProvLabelsEnabledProvider,
} from "../../features/context-label/store";
import { LinkStoreProvider } from "../../features/block-link/store";
import { TableMetaStoreProvider } from "../../features/table-meta/store";
import { MediaInlineLabelProvider } from "../../features/inline-label/media-store";
import { BlockAlignmentProvider } from "../../features/block-alignment/store";
import { AiAssistantProvider } from "../../features/ai-assistant/store";
import { primeAssetText } from "../../features/data-import/asset-text";
import { DataGrid } from "./grid";
import { mergeLinkedColumns } from "./linked";
import { peekDataTable } from "./data";
import { applyExtract, isActiveCondition } from "../../features/data-extract/apply";
import type { ExtractSpec } from "../../features/data-extract/types";
import type { TableSource } from "../../lib/document-types";

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

/**
 * オーブン温度ログの CSV を決定的に生成する（パン作りの世界観）。
 * 見出し time,temp_c,humidity のあと、1 分刻みで n 行分のデータを作る。
 * 乱数は使わず、サイン波の合成で決定的な変動を出す（Storybook を開くたび同じ形）。
 */
function ovenLogCsv(n: number): string {
  const lines = ["time,temp_c,humidity"];
  for (let i = 0; i < n; i++) {
    const hh = String(Math.floor(i / 60)).padStart(2, "0");
    const mm = String(i % 60).padStart(2, "0");
    const temp = 220 + 8 * Math.sin(i / 15) + 2 * Math.sin(i / 3.3);
    const humidity = 35 + 5 * Math.cos(i / 20);
    lines.push(`${hh}:${mm},${temp.toFixed(1)},${humidity.toFixed(1)}`);
  }
  return lines.join("\n");
}

const IMPORTED_AT = "2026-09-05T00:00:00.000Z";
const BASE_OPTIONS = {
  headerRow: 1,
  delimiter: "comma" as const,
  collapseConsecutive: false,
};

function ovenLogSource(fileId: string, rowCount: number): TableSource {
  return {
    kind: "delimited-file",
    fileName: "oven-log.csv",
    fileId,
    importedAt: IMPORTED_AT,
    options: { ...BASE_OPTIONS, endRow: rowCount + 1 },
  };
}

function dataTableContent(source: TableSource | { fileName: string }, caption?: string) {
  return [
    {
      type: "paragraph",
      content: [{ type: "text", text: "オーブン温度ログ（サンプル）", styles: {} }],
    },
    {
      type: "dataTable",
      props: {
        source: serializeDataTableSource(source as TableSource),
        caption: caption ?? "",
      },
    },
  ];
}

function DataTableDemo({ content }: { content: ReturnType<typeof dataTableContent> }) {
  return (
    <EditorProviders>
      <div style={{ maxWidth: 680, border: "1px solid #e5e7eb", borderRadius: 12, padding: 8 }}>
        <SandboxEditor blocks={[dataTableBlock]} initialContent={content as any} />
      </div>
    </EditorProviders>
  );
}

const meta: Meta = {
  title: "Blocks/DataTableBlock",
  parameters: { layout: "padded" },
};
export default meta;

// 2,000 行: 仮想スクロールの確認用（大量行）
export const Default: StoryObj = {
  name: "既定（2,000 行・仮想スクロール）",
  render: () => {
    const fileId = "story-oven-log";
    primeAssetText(fileId, ovenLogCsv(2000));
    const source = ovenLogSource(fileId, 2000);
    return (
      <ErrorBoundary>
        <DataTableDemo content={dataTableContent(source, "オーブン温度ログ（2,000 行）")} />
      </ErrorBoundary>
    );
  },
};

// 5 行: 少数行でもスクロールなしで収まることを確認
export const Small: StoryObj = {
  name: "少数行（5 行）",
  render: () => {
    const fileId = "story-oven-log-small";
    primeAssetText(fileId, ovenLogCsv(5));
    const source = ovenLogSource(fileId, 5);
    return (
      <ErrorBoundary>
        <DataTableDemo content={dataTableContent(source, "オーブン温度ログ（先頭 5 分）")} />
      </ErrorBoundary>
    );
  },
};

// calc の書き戻し（⇥）を計算列として見せる: 見出しの Calculator バッジを確認
// （Provider を経由せず DataGrid に data/linked を直接渡すだけの単純な確認）
export const WithCalcColumns: StoryObj = {
  name: "計算列あり（calc の書き戻し）",
  render: () => {
    const fileId = "story-oven-log-calc";
    primeAssetText(fileId, ovenLogCsv(2000));
    const source = ovenLogSource(fileId, 2000);
    const data = peekDataTable(source);
    if (!data) return <div>素材が読めませんでした</div>;
    // temp_c（℃）を華氏に換算した列と、humidity / temp_c の比を計算列として足す
    const tempF = data.rows.map((r) => {
      const c = Number(r[1]);
      return Number.isFinite(c) ? (c * 9) / 5 + 32 : "";
    });
    const ratio = data.rows.map((r) => {
      const c = Number(r[1]);
      const h = Number(r[2]);
      return Number.isFinite(c) && Number.isFinite(h) && c !== 0 ? (h / c).toFixed(3) : "";
    });
    const merged = mergeLinkedColumns(data, [
      { name: "temp_f", texts: tempF.map(String), calcName: "華氏換算" },
      { name: "ratio", texts: ratio, calcName: "湿度比" },
    ]);
    if (!merged) return <div>計算列を足せませんでした</div>;
    return (
      <ErrorBoundary>
        <div style={{ maxWidth: 680, border: "1px solid #e5e7eb", borderRadius: 12, padding: 8 }}>
          <DataGrid data={merged.data} linked={merged.linked} />
        </div>
      </ErrorBoundary>
    );
  },
};

// 素材が見つからない: 参照切れの枠が出ることを確認
export const MissingAsset: StoryObj = {
  name: "素材が見つからない（参照切れ）",
  render: () => {
    const source = ovenLogSource("story-oven-log-missing", 2000);
    return (
      <ErrorBoundary>
        <DataTableDemo content={dataTableContent(source, "オーブン温度ログ（削除済みの素材）")} />
      </ErrorBoundary>
    );
  },
};

/**
 * 絞り込んだ表。取り込み画面で条件を選んで取り出した小さな表（元ファイルの写し）を作る。
 * 素材には絞った後の CSV を入れ、source.derivation に元のファイル名と条件を残す。
 */
function derivedSource(fileId: string, spec: ExtractSpec): TableSource {
  const [headerLine, ...lines] = ovenLogCsv(120).split("\n");
  const result = applyExtract(
    headerLine.split(","),
    lines.map((l) => l.split(",")),
    spec,
  );
  primeAssetText(
    fileId,
    [result.headers.join(","), ...result.rows.map((r) => r.join(","))].join("\n"),
  );
  return {
    kind: "delimited-file",
    fileName: "oven-log-extract.csv",
    fileId,
    importedAt: IMPORTED_AT,
    options: { ...BASE_OPTIONS, endRow: result.rows.length + 1 },
    derivation: {
      kind: "filter",
      fromFileName: "oven-log.csv",
      columns: spec.columns,
      conditions: spec.conditions.filter(isActiveCondition),
      sourceRows: result.sourceRows,
      resultRows: result.rows.length,
      createdAt: IMPORTED_AT,
    },
  };
}

// 条件 2 つ: 名前の行の下に「条件の文（N 行のうち M 行）」が 1 行出る。「元」のバッジは元のファイル名
export const Filtered: StoryObj = {
  name: "絞り込んだ表（条件 2 つ）",
  render: () => {
    const source = derivedSource("story-oven-log-filtered", {
      columns: [],
      conditions: [
        { column: "temp_c", op: "ge", value: "225" },
        { column: "humidity", op: "le", value: "36" },
      ],
    });
    return (
      <ErrorBoundary>
        <DataTableDemo content={dataTableContent(source, "高温のときの湿度")} />
      </ErrorBoundary>
    );
  },
};

// 列だけ選んだ表: 条件が無いので列の個数で言う
export const FilteredColumnsOnly: StoryObj = {
  name: "絞り込んだ表（列だけ選択）",
  render: () => {
    const source = derivedSource("story-oven-log-columns", {
      columns: ["time", "temp_c"],
      conditions: [],
    });
    return (
      <ErrorBoundary>
        <DataTableDemo content={dataTableContent(source, "温度だけ")} />
      </ErrorBoundary>
    );
  },
};

// 条件が長い表: 1 行に収まらない分は末尾を省略し、全文はカーソルを載せると出る
export const FilteredLongConditions: StoryObj = {
  name: "絞り込んだ表（条件が長い）",
  render: () => {
    const source = derivedSource("story-oven-log-long", {
      columns: [],
      conditions: [
        { column: "temp_c", op: "ge", value: "215" },
        { column: "temp_c", op: "le", value: "235" },
        { column: "humidity", op: "gt", value: "31" },
        { column: "humidity", op: "lt", value: "39" },
        { column: "time", op: "ne", value: "01:30" },
        { column: "time", op: "notEmpty" },
      ],
    });
    return (
      <ErrorBoundary>
        <DataTableDemo content={dataTableContent(source, "窯の安定した時間帯")} />
      </ErrorBoundary>
    );
  },
};
