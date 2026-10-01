// A4 の用紙の幅で書く表示のストーリー
//
// 見てほしいこと:
//   - A4 の用紙の幅（本文 170mm・左右 20mm の対称）で折り返しが印刷と揃うか、紙の見た目が落ち着いているか
//   - 用紙の左の余白にドラッグハンドル（⠿ と ＋）が収まるか（見出し「1. 目的」にも当てる。
//     見出しは ▶ との兼ね合いで外へ寄る。用紙の中だけ寄せを 26px に詰めて、左右とも約 74.6px の溝に収めてある）
//   - 枠が用紙より狭いとき、縮めずに流れる本文へ戻り、右上にアイコンが出るか
//   - 色モード（設定の「読みやすさ（色）」の高コントラスト・白い紙）でも破綻しないか
//     （Controls の colorMode で切り替える。:root の data-color-mode を書き換える）
// 中身は本物のエディタ（SandboxEditor）。モードはストーリーの args で切り替える
// （アプリでは note-app が ⋯ メニューの選択から渡す）。

import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Component,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { SandboxEditor } from "../../base/editor";
import { columnListBlock, columnBlock } from "../../blocks/multi-column";
import { NoteSideMenu } from "../../components/side-menu";
import "../../app.css";
import {
  LabelStoreProvider,
  ProvLabelsEnabledProvider,
} from "../context-label/store";
import { LinkStoreProvider } from "../block-link/store";
import { TableMetaStoreProvider, useTableMetaStore } from "../table-meta/store";
import { TableCaptionLayer } from "../table-meta/caption-layer";
import { MediaInlineLabelProvider } from "../inline-label/media-store";
import { BlockAlignmentProvider } from "../block-alignment/store";
import { AiAssistantProvider } from "../ai-assistant/store";
import { applyColorMode, type ColorMode } from "../settings/store";
import { PaperFrame } from "./PaperFrame";
import { PageGuides } from "./PageGuides";
import type { PaperMode } from "./paper-layout";

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

// note-app.tsx の NoteEditor と同じ Provider スタック（prov ラベル・AI は無効）
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

// ── 中身（研究ノートらしい下書き） ──

const text = (t: string) => [{ type: "text", text: t, styles: {} }];
const p = (t: string) => ({ type: "paragraph", content: text(t) });
const h = (t: string) => ({
  type: "heading",
  props: { level: 2 },
  content: text(t),
});

/**
 * ネットワークに出ない SVG の data URL。中身は簡単な折れ線のプレースホルダ。
 * 縦横比 3:2（480×320）。
 */
function figureUrl(label: string, hue: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='480' height='320'>
    <rect width='100%' height='100%' fill='${hue}'/>
    <polyline points='30,270 110,220 170,240 240,120 300,200 380,90 450,150'
      fill='none' stroke='#2f5d3a' stroke-width='3'/>
    <line x1='30' y1='285' x2='450' y2='285' stroke='#5b6b5f' stroke-width='1.5'/>
    <line x1='30' y1='30' x2='30' y2='285' stroke='#5b6b5f' stroke-width='1.5'/>
    <text x='240' y='312' font-family='sans-serif' font-size='14' fill='#33403a'
      text-anchor='middle'>${label}</text>
  </svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

const figure = (n: number, label: string, caption: string, hue: string) => ({
  type: "image",
  props: { url: figureUrl(label, hue), caption: `図 ${n}  ${caption}` },
});

const cell = (t: string) => text(t);

const TABLE_ID = "paper-mode-table";
const TABLE_CAPTION = "試料 A〜C の測定条件と結果";

// 毎回まっさらな配列を返す（BlockNote が編集で変異させるため共有しない）
function researchNoteContent() {
  return [
    h("1. 目的"),
    p(
      "Cu 粉末の焼鈍温度が結晶子サイズと電気抵抗率に与える影響を調べる。" +
        "報告書の下書きとして、図の並びとキャプション、見出し番号の流れを確かめながら書く。",
    ),
    p(
      "比較する条件は 3 つ（A: 300°C、B: 400°C、C: 500°C）。" +
        "いずれも Ar 雰囲気で 2 時間保持し、炉内で自然冷却した。",
    ),
    h("2. 実験方法"),
    p(
      "Cu 粉末（純度 99.9%、平均粒径 5 µm）1 g をシリカ管に封入し、電気炉で焼鈍した。" +
        "XRD で結晶子サイズ（Scherrer の式）を、四端子法で電気抵抗率を評価した。",
    ),
    p("図 1〜4 に各条件の XRD パターンと断面の観察像を並べる。"),
    {
      type: "columnList",
      children: [
        {
          type: "column",
          children: [
            figure(1, "A: 300°C  XRD", "試料 A（300°C）の XRD パターン", "#dbe7db"),
            figure(3, "B: 400°C  XRD", "試料 B（400°C）の XRD パターン", "#e4e8d2"),
          ],
        },
        {
          type: "column",
          children: [
            figure(2, "A: 300°C  断面", "試料 A（300°C）の断面", "#dfe6ea"),
            figure(4, "B: 400°C  断面", "試料 B（400°C）の断面", "#ead9d6"),
          ],
        },
      ],
    },
    h("3. 結果"),
    p(
      "焼鈍温度が高いほど結晶子サイズは大きくなり、電気抵抗率は下がった。" +
        "表 1 に各試料の条件と結果をまとめる。",
    ),
    {
      id: TABLE_ID,
      type: "table",
      content: {
        type: "tableContent",
        rows: [
          {
            cells: [
              cell("試料"),
              cell("温度 (°C)"),
              cell("結晶子サイズ (nm)"),
              cell("抵抗率 (µΩ·cm)"),
            ],
          },
          { cells: [cell("A"), cell("300"), cell("38"), cell("2.4")] },
          { cells: [cell("B"), cell("400"), cell("54"), cell("2.1")] },
          { cells: [cell("C"), cell("500"), cell("71"), cell("1.9")] },
        ],
      },
    },
    p(
      "結晶子サイズの増大に伴う粒界散乱の減少が、抵抗率低下の主因と考えられる。" +
        "ただし試料数が少ないため、再現性は追加の測定で確かめる。",
    ),
  ];
}

// 3 ページほどになる長さ（改ページの目安の線を見るストーリー用）。研究ノートの下書きに考察を足す
function longNoteContent() {
  const body = (n: number) =>
    p(
      `考察 ${n}。焼鈍温度が上がると粒界が減り、電子の散乱が弱まって抵抗率が下がる。` +
        "一方で、結晶子サイズの見積もりには Scherrer の式の仮定（球状・歪みなし）が効くため、" +
        "絶対値より条件間の傾向を読むのが妥当である。再現性は追加の測定で確かめる。",
    );
  const more = [1, 2, 3, 4].flatMap((i) => [
    h(`${3 + i}. 考察 ${i}`),
    body(i * 3 - 2),
    body(i * 3 - 1),
    body(i * 3),
    figure(4 + i, `C${i}: 500°C  XRD`, `追加の測定 ${i} の XRD パターン`, "#e1e8da"),
  ]);
  return [...researchNoteContent(), ...more];
}

// ── 1 つの表示（枠 + PaperFrame + 本物のエディタ） ──

/** 本物のエディタを PaperFrame に入れる。TableMetaStoreProvider の内側で使う */
function PaperEditor({ mode, long = false }: { mode: PaperMode; long?: boolean }) {
  const editorRef = useRef<any>(null);
  const store = useTableMetaStore();
  const [content] = useState(long ? longNoteContent : researchNoteContent);
  // TableCaptionLayer がキャプションを重ねて描く相手（実アプリではエディタペイン）
  const [wrapperEl, setWrapperEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    store.setCaption(TABLE_ID, TABLE_CAPTION);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    // data-label-wrapper: caption-layer のポータル先。実アプリではエディタペインに付いている
    <div ref={setWrapperEl} data-label-wrapper style={{ position: "relative" }}>
      <PaperFrame mode={mode} overlay={<PageGuides title="Cu 粉末の焼鈍温度と電気抵抗率" />}>
        {/* 実アプリのタイトル・文脈タグと同じ体裁。左右の溝は本文と同じ変数に揃える */}
        <div
          className="mt-3 mb-5 text-3xl font-bold leading-tight"
          style={{
            paddingLeft: "var(--gph-gutter-left, 54px)",
            paddingRight: "var(--gph-gutter-right, 54px)",
          }}
        >
          Cu 粉末の焼鈍温度と電気抵抗率
        </div>
        <div
          className="-mt-3 mb-5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
          style={{
            paddingLeft: "var(--gph-gutter-left, 54px)",
            paddingRight: "var(--gph-gutter-right, 54px)",
          }}
        >
          <span className="rounded-full border px-2 py-0.5">実験ノート</span>
          <span className="rounded-full border px-2 py-0.5">Cu</span>
          <span className="rounded-full border px-2 py-0.5">XRD</span>
        </div>
        <SandboxEditor
          blocks={[columnListBlock, columnBlock]}
          sideMenu={NoteSideMenu}
          initialContent={content}
          onEditorReady={(editor) => {
            editorRef.current = editor;
          }}
        />
      </PaperFrame>
      <TableCaptionLayer editorRef={editorRef} wrapperEl={wrapperEl} />
    </div>
  );
}

/** 幅 width の枠に 1 つ置く。Provider（表の名前などの状態）は枠ごとに分ける */
function PaperDemo({ mode, width, long = false }: { mode: PaperMode; width: number; long?: boolean }) {
  return (
    <ErrorBoundary>
      <EditorProviders>
        <div
          style={{
            width,
            border: "1px dashed var(--rule)",
            background: "var(--color-background)",
          }}
        >
          <PaperEditor mode={mode} long={long} />
        </div>
      </EditorProviders>
    </ErrorBoundary>
  );
}

/**
 * 色モードを :root に反映する（設定モーダルと同じ applyColorMode）。
 * ストーリーを離れるときは既定に戻し、ほかのストーリーへ持ち越さない。
 */
function ColorModeAxis({ value, children }: { value: ColorMode; children: ReactNode }) {
  useEffect(() => {
    applyColorMode(value);
    return () => applyColorMode("");
  }, [value]);
  return <>{children}</>;
}

/** ストーリーの冒頭の 1 行（何を見るストーリーか） */
function StoryNote({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: "0 0 12px",
        fontSize: 13,
        lineHeight: 1.6,
        color: "var(--ink-3)",
      }}
    >
      {children}
    </p>
  );
}

type Args = { mode: PaperMode; width: number; colorMode: ColorMode };

const meta: Meta<Args> = {
  title: "Features/PaperMode",
  parameters: { layout: "padded" },
  args: { mode: "standard", width: 900, colorMode: "" },
  argTypes: {
    colorMode: {
      control: "inline-radio",
      options: ["", "high-contrast", "white-paper"],
      description: "色モード（設定の「読みやすさ（色）」）。空文字はデフォルト",
    },
    mode: { control: "inline-radio", options: ["standard", "a4"] },
    width: { control: { type: "number", min: 320, max: 1600, step: 20 } },
  },
};
export default meta;

type Story = StoryObj<Args>;

// 今の表示。本文は最大幅 828px の中央カラム（本文 720px）。
export const Standard: Story = {
  name: "Standard（今の表示・幅 900px）",
  args: { mode: "standard", width: 900 },
  render: ({ mode, width, colorMode }) => (
    <ColorModeAxis value={colorMode}>
      <StoryNote>
        今の表示。本文は最大幅 828px（本文 720px）の中央カラムで、机も用紙も無い。A4 と見比べる基準。
      </StoryNote>
      <PaperDemo mode={mode} width={width} />
    </ColorModeAxis>
  ),
};

// A4。机の上に用紙。本文の幅は A4 のノートの印刷と同じ 170mm（左右 20mm）。
export const A4: Story = {
  name: "A4（幅 1280px）",
  args: { mode: "a4", width: 1280 },
  render: ({ mode, width, colorMode }) => (
    <ColorModeAxis value={colorMode}>
      <StoryNote>
        A4 の用紙の幅（210mm）で書く表示。本文は A4 のノートの印刷と同じ 170mm。ブロックにカーソルを当て、左の余白にドラッグハンドル（⠿ と ＋）が収まるかを見る。
      </StoryNote>
      <PaperDemo mode={mode} width={width} />
    </ColorModeAxis>
  ),
};

// A4 で 3 ページほどになる長いノート。印刷でページが変わる位置の高さに、用紙の左右の机へ点線と番号（2 ページ・3 ページ…）が出る。
export const A4PageGuides: Story = {
  name: "A4PageGuides（長いノート・改ページの目安の線）",
  args: { mode: "a4", width: 1280 },
  render: ({ mode, width, colorMode }) => (
    <ColorModeAxis value={colorMode}>
      <StoryNote>
        印刷でページが変わる位置の高さに、用紙の後ろの机（左右）へ目安の線（点線）と、右の机に番号（2 ページ目から）が出る。本文・用紙の上には何も重ならない。
        図は途中で切らず次のページの頭へ送り、見出しは直後で改ページになるなら見出しごと送る。印刷とは数行ずれることがある目安。
        本文を編集すると少し待って引き直す。標準の表示・狭い枠（流れる本文）では出ない。
      </StoryNote>
      <PaperDemo mode={mode} width={width} long />
    </ColorModeAxis>
  ),
};

// 用紙が出る最小付近の枠（824px）。机の余白は左右 12px まで詰めてあり、用紙は 210mm（約 794px）。
// Windows 150%（1280 幅）で右パネルを開いたまま 80% に縮小した本文枠がこの幅になる。
export const A4Tight: Story = {
  name: "A4Tight（幅 824px・机 12px で用紙のまま）",
  args: { mode: "a4", width: 824 },
  render: ({ mode, width, colorMode }) => (
    <ColorModeAxis value={colorMode}>
      <StoryNote>
        用紙が出る最小付近の幅（用紙 210mm（約 794px）+ 机 12px × 2 = 818px から）。机が細くても用紙のまま出て、左の余白にハンドルが収まるかを見る。817px 以下では流れる本文に戻る（A4Narrow）。
      </StoryNote>
      <PaperDemo mode={mode} width={width} />
    </ColorModeAxis>
  ),
};

// 枠が用紙より狭い。紙の見た目をやめて流れる本文に戻り、右上に小さなアイコンが出る。
export const A4Narrow: Story = {
  name: "A4Narrow（幅 600px・流れる本文に戻る）",
  args: { mode: "a4", width: 600 },
  render: ({ mode, width, colorMode }) => (
    <ColorModeAxis value={colorMode}>
      <StoryNote>
        枠が用紙より狭いとき。縮めて見せず、今の流れる本文に戻り、本文の右上に小さなアイコンが出る（マウスを載せると理由が出る）。画像の並びも今と同じ。
      </StoryNote>
      <PaperDemo mode={mode} width={width} />
    </ColorModeAxis>
  ),
};

// 同じ中身を 1280px の枠に 2 つ。今の表示と A4 で折り返しがどう変わるか。
export const Compare: Story = {
  name: "Compare（今の表示 / A4・幅 1280px）",
  render: ({ colorMode }) => (
    <ColorModeAxis value={colorMode}>
      <StoryNote>
        同じ中身を今の表示（上）と A4（下）で並べる。本文の幅が 720px → 約 643px（170mm）に変わり、折り返し・図の大きさがどう変わるかを見る。
      </StoryNote>
      <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
        <div>
          <StoryNote>今の表示（standard）</StoryNote>
          <PaperDemo mode="standard" width={1280} />
        </div>
        <div>
          <StoryNote>A4（a4）</StoryNote>
          <PaperDemo mode="a4" width={1280} />
        </div>
      </div>
    </ColorModeAxis>
  ),
};
