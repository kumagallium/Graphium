// 狭い本文枠の余白・ラベルのチップのストーリー
//
// 右パネルを開くと本文枠は 250〜410px まで縮む（853×440・1024×528）。枠の中の余白が
// 固定のままだと文字の幅が 45〜196px に痩せるので、枠が狭いときだけ詰める
// （lib/pane-layout.ts）。実アプリと同じ枠の作り（余白・溝の CSS 変数・狭い枠の印）で、
// 本物のエディタを 3 つの幅で並べる。
//   - 257px / 408px: 詰めた余白。文字の幅が 150px 以上 / 300px 以上あること
//   - 700px: 広い枠。今までと同じ余白
// ステップのカードの中の狭い表につけたラベルのチップは、名前の行の右隣に置くとカードの
// 右の罫線を越えるので、名前の行の上（2 段目）へ積む。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { SandboxEditor } from "../../base/editor";
import { stepBlock } from "../../blocks/step";
import { NoteSideMenu } from "../../components/side-menu";
import "../../app.css";
import {
  LabelStoreProvider,
  ProvLabelsEnabledProvider,
  useLabelStore,
} from "./store";
import { ProvIndicatorLayer } from "./prov-indicator";
import { LinkStoreProvider } from "../block-link/store";
import { TableMetaStoreProvider } from "../table-meta/store";
import { TableCaptionLayer } from "../table-meta/caption-layer";
import { MediaInlineLabelProvider } from "../inline-label/media-store";
import { MediaOcrProvider } from "../media-ocr/store";
import { BlockAlignmentProvider } from "../block-alignment/store";
import { AiAssistantProvider } from "../ai-assistant/store";
import { useNarrowPane } from "../../hooks/use-narrow-pane";
import { NARROW_PANE_ATTR, paneTextWidth, resolvePaneSpacing } from "../../lib/pane-layout";

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
    <ProvLabelsEnabledProvider enabled>
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
const para = (text: string) => ({ type: "paragraph", content: cell(text) });

const TABLE_ID = "narrow-pane-table";

// ステップのカードの中に、幅の狭い表（2 列）を 1 つ。ラベル [インプット] を付ける
const content = [
  para("右パネルを開いたときの本文の幅で、文字がどう折り返されるかを見る。"),
  {
    type: "step",
    content: cell("1. 試料を準備する"),
    children: [
      para("基板を洗浄して乾燥させた。"),
      {
        id: TABLE_ID,
        type: "table",
        content: {
          type: "tableContent",
          rows: [
            { cells: [cell("名前"), cell("量")] },
            { cells: [cell("S-01"), cell("2 g")] },
          ],
        },
      },
    ],
  },
  para("ステップの外の段落。"),
];

/** 実アプリの本文枠（note-app.tsx）と同じ作りの枠。幅は外から決める */
function NarrowPaneDemo({ width }: { width: number }) {
  const [paneEl, setPaneEl] = useState<HTMLDivElement | null>(null);
  const narrow = useNarrowPane(paneEl, true);
  const { setLabel } = useLabelStore();
  const editorRef = useRef<any>(null);
  useEffect(() => {
    setLabel(TABLE_ID, "material");
  }, [setLabel]);
  const spacing = resolvePaneSpacing({ isDesktop: true, hasLabels: true, narrow });
  return (
    <div>
      <div style={{ fontSize: 12, color: "#6b7f6e", marginBottom: 6 }}>
        枠 {width}px → {narrow ? "狭い（余白を詰める）" : "広い（今までと同じ）"}・
        文字の幅 約 {paneTextWidth(width, spacing)}px
      </div>
      <div style={{ width, height: 520, display: "flex", border: "1px solid #d5e0d7" }}>
        <div
          ref={setPaneEl}
          data-label-wrapper
          {...(narrow ? { [NARROW_PANE_ATTR]: "" } : {})}
          className="flex-1 overflow-auto relative"
          style={{
            ["--gph-gutter-left" as string]: `${spacing.gutterLeft}px`,
            ["--gph-gutter-right" as string]: `${spacing.gutterRight}px`,
          }}
        >
          <div
            style={{
              padding: "16px 0",
              paddingLeft: spacing.padLeft,
              paddingRight: spacing.padRight,
            }}
          >
            <div style={{ maxWidth: 828, marginInline: "auto" }}>
              <h1 className="block w-full text-3xl font-bold leading-tight mt-3 mb-5 pl-[var(--gph-gutter-left,54px)] pr-[var(--gph-gutter-right,54px)] break-words">
                新しいノート
              </h1>
              <SandboxEditor
                blocks={[stepBlock]}
                initialContent={content}
                sideMenu={NoteSideMenu}
                onEditorReady={(editor) => {
                  editorRef.current = editor;
                }}
              />
            </div>
          </div>
          <TableCaptionLayer editorRef={editorRef} wrapperEl={paneEl} />
          <ProvIndicatorLayer wrapperEl={paneEl} />
        </div>
      </div>
    </div>
  );
}

const meta: Meta = {
  title: "Features/ContextLabel/NarrowPane",
  parameters: { layout: "padded" },
};
export default meta;

export const Widths: StoryObj = {
  name: "本文枠の幅ごとの余白（257 / 408 / 700px）",
  render: () => (
    <ErrorBoundary>
      <EditorProviders>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
          <NarrowPaneDemo width={257} />
          <NarrowPaneDemo width={408} />
          <NarrowPaneDemo width={700} />
        </div>
      </EditorProviders>
    </ErrorBoundary>
  ),
};
