// StepBlock 実現性スパイクのストーリー
// children（段落・テーブル・画像・コード）を持つ step コンテナが
// 描画・680px・標準ドラッグのネスト/アンネストで成立するかを目視・操作確認する。
// あわせて「囲みの体裁」3 案（レール / レール+地色 / 全周枠）を見比べる。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Component, type ReactNode } from "react";
import { SandboxEditor } from "../../base/editor";
import { stepBlock } from "./index";
// step コンテナの体裁（静かな全周枠）は app.css にある
import "../../app.css";
// SandboxEditor は note-app と同じ Context 群を要求する（SelectionToolbar /
// InlineAnchorController が常時 mount するため）。ストーリーでも同じ Provider で括る。
import {
  LabelStoreProvider,
  ProvLabelsEnabledProvider,
} from "../../features/context-label/store";
import { LinkStoreProvider } from "../../features/block-link/store";
import { IndexTableStoreProvider } from "../../features/index-table/store";
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

// note-app.tsx の NoteEditor と同じ Provider スタック（スパイクでは prov ラベル/AI は無効）
function EditorProviders({ children }: { children: ReactNode }) {
  return (
    <ProvLabelsEnabledProvider enabled={false}>
      <LabelStoreProvider>
        <LinkStoreProvider>
          <IndexTableStoreProvider>
            <MediaInlineLabelProvider>
              <BlockAlignmentProvider>
                <AiAssistantProvider aiAvailable={false}>
                  {children}
                </AiAssistantProvider>
              </BlockAlignmentProvider>
            </MediaInlineLabelProvider>
          </IndexTableStoreProvider>
        </LinkStoreProvider>
      </LabelStoreProvider>
    </ProvLabelsEnabledProvider>
  );
}

// step コンテナの体裁（採用案D「静かな全周枠」）は app.css にベイク済み。
// ここではモード帯（§4.4）の見え方モックだけを足す。
//
// DOM: .bn-block > .react-renderer.node-step > .bn-block-content[data-content-type=step]
//      .bn-block > .bn-block-group > .bn-block-outer（子ブロック）
const CONTAINER_STYLES = `
/* ── モード帯（計画）のモック ──
   §4.4 の「計画＝任意のリッチな帯」を視覚だけ再現する（実装は本体タスク）。
   各ステップの最初の 2 子を帯として塗り、土台（案D の枠線）と競合しないか確認する。 */
.gx-band .bn-block:has(> .react-renderer.node-step) > .bn-block-group > .bn-block-outer:nth-child(-n+2) {
  background: #dbe7f5;
}
.gx-band .bn-block:has(> .react-renderer.node-step) > .bn-block-group > .bn-block-outer:nth-child(1) {
  border-radius: 6px 6px 0 0;
  padding-top: 3px;
}
.gx-band .bn-block:has(> .react-renderer.node-step) > .bn-block-group > .bn-block-outer:nth-child(2) {
  border-radius: 0 0 6px 6px;
  padding-bottom: 3px;
}
`;
function ContainerStyles() {
  return <style dangerouslySetInnerHTML={{ __html: CONTAINER_STYLES }} />;
}

// ネットワーク非依存のプレースホルダ画像（小さな SVG data URL）
const IMG_DATA_URL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='90'>
       <rect width='100%' height='100%' fill='#dbe7db'/>
       <text x='50%' y='50%' font-family='sans-serif' font-size='14'
             fill='#3a7a3a' text-anchor='middle' dominant-baseline='middle'>
         結果の写真（子ブロック）
       </text>
     </svg>`,
  );

// 毎回まっさらな initialContent を返す（BlockNote が編集で変異させるため共有しない）
function stepContent() {
  return [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "この段落を左のドラッグハンドルでステップの中へ入れてみる（ネスト）。",
          styles: {},
        },
      ],
    },
    {
      type: "step",
      content: [{ type: "text", text: "反応 A を実施する", styles: {} }],
      children: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "試薬を混合し 60°C で 30 分撹拌した。", styles: {} },
          ],
        },
        {
          type: "table",
          content: {
            type: "tableContent",
            rows: [
              {
                cells: [
                  [{ type: "text", text: "試薬", styles: {} }],
                  [{ type: "text", text: "量", styles: {} }],
                  [{ type: "text", text: "備考", styles: {} }],
                ],
              },
              {
                cells: [
                  [{ type: "text", text: "NaCl", styles: {} }],
                  [{ type: "text", text: "5 g", styles: {} }],
                  [{ type: "text", text: "特級", styles: {} }],
                ],
              },
              {
                cells: [
                  [{ type: "text", text: "水", styles: {} }],
                  [{ type: "text", text: "100 mL", styles: {} }],
                  [{ type: "text", text: "脱イオン", styles: {} }],
                ],
              },
            ],
          },
        },
        { type: "image", props: { url: IMG_DATA_URL, previewWidth: 240 } },
        {
          type: "codeBlock",
          props: { language: "python" },
          content: [{ type: "text", text: "yield = 0.87  # 収率", styles: {} }],
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "ステップの外（後ろ）の段落。", styles: {} },
      ],
    },
  ];
}

// 実運用に近い「ステップが連続するノート」。体裁の差は 1 個では出ず、
// 連続したときの重さ・境界の分かりやすさで効いてくるので比較用に用意する。
function multiStepContent() {
  const p = (text: string) => ({
    type: "paragraph",
    content: [{ type: "text", text, styles: {} }],
  });
  const step = (title: string, children: any[]) => ({
    type: "step",
    content: [{ type: "text", text: title, styles: {} }],
    children,
  });
  return [
    p("試料 X の合成と評価。"),
    step("1. 前処理", [
      p("基板を超音波洗浄（アセトン → IPA、各 10 分）した。"),
      p("窒素ブローで乾燥させ、直ちに次工程へ移した。"),
      p("表面の水滴痕は目視で確認できなかった。"),
    ]),
    step("2. 反応 A を実施する", [
      p("試薬を混合し 60°C で 30 分撹拌した。"),
      {
        type: "table",
        content: {
          type: "tableContent",
          rows: [
            {
              cells: [
                [{ type: "text", text: "試薬", styles: {} }],
                [{ type: "text", text: "量", styles: {} }],
              ],
            },
            {
              cells: [
                [{ type: "text", text: "NaCl", styles: {} }],
                [{ type: "text", text: "5 g", styles: {} }],
              ],
            },
          ],
        },
      },
      {
        type: "codeBlock",
        props: { language: "python" },
        content: [{ type: "text", text: "yield = 0.87  # 収率", styles: {} }],
      },
    ]),
    step("3. 収率を評価する", [
      p("秤量の結果、収率は 87% だった。"),
      p("前回（82%）から改善している。"),
    ]),
    p("以上。次回は温度条件を振る。"),
  ];
}

// 1 つのエディタ（指定の体裁クラスで囲む）
function StepDemo({
  variantClass,
  content,
}: {
  variantClass: string;
  content?: any[];
}) {
  return (
    <EditorProviders>
      <div
        className={`gx-step-demo ${variantClass}`}
        style={{
          maxWidth: 680,
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 8,
        }}
      >
        <SandboxEditor
          blocks={[stepBlock]}
          initialContent={content ?? stepContent()}
        />
      </div>
    </EditorProviders>
  );
}

const meta: Meta = {
  title: "Blocks/StepBlock (spike)",
  parameters: { layout: "padded" },
};
export default meta;

// 基本: children（段落・テーブル・画像・コード）を持つ step
// 体裁は app.css の「静かな全周枠」がそのまま当たる
export const WithChildren: StoryObj = {
  name: "children（段落/テーブル/画像/コード）",
  render: () => (
    <Safe>
      <ContainerStyles />
      <StepDemo variantClass="" />
    </Safe>
  ),
};

// ステップが連続するノート（実運用に近い見え方）
export const MultiStep: StoryObj = {
  name: "連続するステップ",
  render: () => (
    <Safe>
      <ContainerStyles />
      <StepDemo variantClass="" content={multiStepContent()} />
    </Safe>
  ),
};

// モード帯（計画）を載せた場合。枠線の土台と帯の塗りが競合しないことを確認する。
export const WithModeBand: StoryObj = {
  name: "モード帯（計画）を載せた場合",
  render: () => (
    <Safe>
      <ContainerStyles />
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>
        各ステップの最初の 2 ブロックを「計画帯」として塗ったモック（§4.4）。
        帯の実装は本体タスクで行う。
      </div>
      <StepDemo variantClass="gx-band" content={multiStepContent()} />
    </Safe>
  ),
};
