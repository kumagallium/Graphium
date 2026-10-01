// 画像ブロックの高さの上限のストーリー
// 目視・操作確認の観点:
//   - 高さ 660px の枠（Windows 既定の 150% 表示の実効ビューポート ≒ 1280×660）の中で、
//     縦長・正方形・横長の画像が 1 枚で枠を超えないか（縦長ほど細く表示される）
//   - 上限は previewWidth 未指定（挿入したまま）の画像だけ。指定（端をつまんで決めた）画像は
//     上限なしで、本文の幅いっぱいまで広がるか
//   - 上限に当たった画像でも、ホバーで出るリサイズハンドル・選択枠が画像の縁に付くか
//     （挿入したままの画像は右ハンドルを押した時点で上限が外れ、上限より大きく広げられる。
//     離すと previewWidth が入って上限なしのまま。狭める方向も効く）
//   - マルチカラムの列幅が狭いときは列幅が勝つか
//   - 上限の値（50 / 60 / 70）の見比べ。本番の値は app.css の --graphium-image-max-h
//
// 上限の既定は 50dvh（画面の高さの 1/2）。dvh はブラウザのビューポート基準で枠の
// 高さには追従しないので、ストーリーでは「660px の画面」相当の px を変数に直接入れて
// 見比べる（50% = 330px / 60% = 396px / 70% = 462px。本番は 50%）。「実際の dvh」のストーリーだけは
// 何も上書きしないので、Storybook のビューポートの高さで実際の見え方を確かめられる。
// 画像はネットワークに出ない SVG の data URL。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Component, type CSSProperties, type ReactNode } from "react";
import { SandboxEditor } from "../../base/editor";
import { columnListBlock, columnBlock } from "../multi-column";
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
    <ErrorBoundary>
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
    </ErrorBoundary>
  );
}

/** ネットワーク非依存の画像（寸法と色つきの SVG data URL） */
function svgImage(width: number, height: number, label: string, fill: string): string {
  return (
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'>
         <rect width='100%' height='100%' fill='${fill}'/>
         <rect x='1' y='1' width='${width - 2}' height='${height - 2}' fill='none' stroke='#3a7a3a' stroke-width='2'/>
         <text x='50%' y='50%' font-family='sans-serif' font-size='${Math.max(14, Math.round(Math.min(width, height) / 10))}'
               fill='#1f4d1f' text-anchor='middle' dominant-baseline='middle'>${label}</text>
       </svg>`,
    )
  );
}

const TALL = svgImage(400, 800, "縦長 400×800", "#dbe7db");
const SQUARE = svgImage(600, 600, "正方形 600×600", "#e7e3d0");
const WIDE = svgImage(1200, 500, "横長 1200×500", "#d6e3ee");

const p = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text, styles: {} }],
});

// 毎回まっさらな initialContent を返す（BlockNote が編集で変異させるため共有しない）
function imageContent() {
  return [
    p("縦長・previewWidth 未指定"),
    { type: "image", props: { url: TALL, name: "tall", caption: "縦長（幅の指定なし）" } },
    p("正方形・previewWidth 未指定"),
    { type: "image", props: { url: SQUARE, name: "square" } },
    p("横長・previewWidth 未指定"),
    { type: "image", props: { url: WIDE, name: "wide" } },
    p("正方形・previewWidth 700（大きさを決めた画像は上限なし。枠の幅まで）"),
    { type: "image", props: { url: SQUARE, name: "square-700", previewWidth: 700 } },
    p("正方形・previewWidth 240（上限より小さい）"),
    { type: "image", props: { url: SQUARE, name: "square-240", previewWidth: 240 } },
    p("横長・previewWidth 700"),
    { type: "image", props: { url: WIDE, name: "wide-700", previewWidth: 700 } },
    p("中央寄せ・縦長"),
    { type: "image", props: { url: TALL, name: "tall-center", textAlignment: "center" } },
    p("おしまい。"),
  ];
}

/** 上限の見比べ（画面の高さを 660px としたときの割合。0 は上限なし＝従来の見た目） */
type CapPercent = 0 | 50 | 60 | 70;
const VIEWPORT_H = 660;

function capStyle(percent: CapPercent | "real"): CSSProperties {
  if (percent === "real") return {};
  // 0 は「上限なし」。十分に大きい値を入れると min(100%, …) の 100% が勝つ
  const value = percent === 0 ? "100000px" : `${(VIEWPORT_H * percent) / 100}px`;
  return { ["--graphium-image-max-h" as string]: value };
}

/** 高さ 660px の枠（Windows 既定の実質の高さ）。中はスクロールできる */
function Frame({
  percent,
  children,
  width = 860,
}: {
  percent: CapPercent | "real";
  children: ReactNode;
  width?: number;
}) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
        {percent === "real"
          ? "上限 = app.css の既定（50dvh）。この Storybook のビューポートの高さで決まる"
          : percent === 0
            ? "上限なし（従来の見た目）"
            : `上限 = 画面の高さ 660px の ${percent}%（${(VIEWPORT_H * percent) / 100}px）`}
      </div>
      <div
        style={{
          ...capStyle(percent),
          width,
          maxWidth: "100%",
          height: percent === "real" ? undefined : VIEWPORT_H,
          overflow: "auto",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 8,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function ImageDemo({ percent }: { percent: CapPercent | "real" }) {
  return (
    <EditorProviders>
      <Frame percent={percent}>
        <SandboxEditor initialContent={imageContent()} />
      </Frame>
    </EditorProviders>
  );
}

const meta: Meta = {
  title: "Blocks/Image max height",
  parameters: { layout: "padded" },
};
export default meta;

export const Default50: StoryObj = {
  name: "50%（既定）— 高さ 660px の枠",
  render: () => <ImageDemo percent={50} />,
};

export const Cap60: StoryObj = {
  name: "60% — 高さ 660px の枠",
  render: () => <ImageDemo percent={60} />,
};

export const Cap70: StoryObj = {
  name: "70% — 高さ 660px の枠",
  render: () => <ImageDemo percent={70} />,
};

export const NoCap: StoryObj = {
  name: "上限なし（従来の見た目・比較用）",
  render: () => <ImageDemo percent={0} />,
};

export const RealDvh: StoryObj = {
  name: "実際の 50dvh（Storybook のビューポート基準）",
  render: () => <ImageDemo percent="real" />,
};

/** マルチカラム: 列幅のほうが狭ければ列幅が勝つ（min(100%, …)） */
function multiColumnContent() {
  return [
    p("2 カラムに正方形と縦長を並べる。列幅（約 400px）は高さの上限より小さいので列幅が勝つ。"),
    {
      type: "columnList",
      children: [
        {
          type: "column",
          children: [
            { type: "image", props: { url: SQUARE, name: "col-square", caption: "左: 正方形" } },
          ],
        },
        {
          type: "column",
          children: [{ type: "image", props: { url: TALL, name: "col-tall", caption: "右: 縦長" } }],
        },
      ],
    },
    p("カラムの後の段落。"),
  ];
}

export const InColumns: StoryObj = {
  name: "マルチカラムに 2 枚",
  render: () => (
    <EditorProviders>
      <Frame percent={50}>
        <SandboxEditor blocks={[columnListBlock, columnBlock]} initialContent={multiColumnContent()} />
      </Frame>
    </EditorProviders>
  ),
};

/** 閲覧専用（共有ノートの閲覧と同じ）。ハンドルは出ないが上限は効く */
export const ReadOnly: StoryObj = {
  name: "閲覧専用（共有ノート相当）",
  render: () => (
    <EditorProviders>
      <Frame percent={50}>
        <SandboxEditor editable={false} initialContent={imageContent()} />
      </Frame>
    </EditorProviders>
  ),
};

/** 幅の狭い枠（サイドピークの inline 幅 ≒ 320〜480px 相当）。幅のほうが先に効く */
export const NarrowPane: StoryObj = {
  name: "狭い枠（サイドピーク相当 400px）",
  render: () => (
    <EditorProviders>
      <Frame percent={50} width={400}>
        <SandboxEditor initialContent={imageContent()} />
      </Frame>
    </EditorProviders>
  ),
};
