// Composer（Cmd+K）のビジュアル確認用ストーリー
// 現状 UI は Ask 単機能なので、入力有り / 発見カード有り の 2 ストーリーだけ提供。
// モード切替 UI は持っていないため、他モードの表示確認は不要。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { LocaleProvider } from "@/i18n";
import { Composer } from "./Composer";
import type { ComposerMode, ComposerSubmission, DiscoveryCard } from "./types";
import type { GraphiumIndex, NoteIndexEntry } from "../navigation/index-file";
import type { MediaIndex, MediaIndexEntry } from "../asset-browser/media-index";

const meta: Meta<typeof Composer> = {
  title: "Molecules/Composer",
  component: Composer,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Cmd+K で開くグローバル Composer（Ask 単機能）。送信は右パネル Chat に流れるが、本ストーリーは配線なしのシェルで、submit と発見カード選択は console に流れる。",
      },
    },
  },
};
export default meta;

type Args = {
  showDiscoveryCards?: boolean;
  /** 検索ソース。指定すると検索 UI（ノートリスト + AI 質問アクション）が出る */
  withSearch?: boolean;
  /** 初期入力。検索結果プレビューを楽に確認したいとき用 */
  initialPrompt?: string;
};

const sampleNotes: NoteIndexEntry[] = [
  {
    noteId: "n-xrd-procedure",
    title: "XRD analysis standard procedure",
    modifiedAt: "2026-04-25T10:00:00.000Z",
    createdAt: "2026-04-01T00:00:00.000Z",
    headings: [],
    labels: [{ blockId: "b1", label: "procedure", preview: "" }],
    outgoingLinks: [],
    source: "human",
    author: "kumagai",
  },
  {
    noteId: "n-xrd-log",
    title: "XRD raw log 2026-04",
    modifiedAt: "2026-04-24T08:00:00.000Z",
    createdAt: "2026-04-10T00:00:00.000Z",
    headings: [],
    labels: [],
    outgoingLinks: [],
    source: "human",
  },
  {
    noteId: "n-claude-session",
    title: "Claude Code セッション要約",
    modifiedAt: "2026-04-23T20:00:00.000Z",
    createdAt: "2026-04-23T19:00:00.000Z",
    headings: [],
    labels: [],
    outgoingLinks: [],
    source: "human",
    author: "kumagai",
    model: "claude-opus-4-7",
  },
  {
    noteId: "w-xrd",
    title: "XRD",
    modifiedAt: "2026-04-22T00:00:00.000Z",
    createdAt: "2026-04-22T00:00:00.000Z",
    headings: [],
    labels: [],
    outgoingLinks: [],
    source: "ai",
    wikiKind: "claim",
    model: "claude-opus-4-7",
  },
  {
    noteId: "n-design-misc",
    title: "Design notes — UI スパイク",
    modifiedAt: "2026-04-20T00:00:00.000Z",
    createdAt: "2026-04-20T00:00:00.000Z",
    headings: [{ blockId: "h1", text: "About XRD measurement", level: 2 }],
    labels: [],
    outgoingLinks: [],
    source: "human",
  },
];

const sampleIndex: GraphiumIndex = {
  version: 6,
  updatedAt: "2026-04-25T10:00:00.000Z",
  notes: sampleNotes,
};

/** サムネイルの見え方を確認するためのダミー画像（data URL なのでプロバイダ解決を通らない） */
function swatch(label: string, bg: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='64' height='64' fill='${bg}'/><text x='6' y='38' font-family='sans-serif' font-size='13' fill='%23384038'>${label}</text></svg>`;
  return `data:image/svg+xml,${svg.replace(/#/g, "%23").replace(/</g, "%3C").replace(/>/g, "%3E")}`;
}

const sampleMedia: MediaIndexEntry[] = [
  {
    fileId: "img-xrd-pattern",
    name: "XRD-pattern-2026-04.png",
    type: "image",
    mimeType: "image/png",
    url: swatch("XRD", "#dfe7d6"),
    thumbnailUrl: swatch("XRD", "#dfe7d6"),
    uploadedAt: "2026-04-24T09:00:00.000Z",
    usedIn: [{ noteId: "n-xrd-log", noteTitle: "XRD raw log 2026-04", blockId: "b1" }],
    ocrText: "2θ = 28.4°  強度 1240 counts  スキャン速度 2°/min",
  },
  {
    fileId: "img-furnace-panel",
    name: "IMG_2041.jpg",
    type: "image",
    mimeType: "image/jpeg",
    url: swatch("800", "#e8e0cf"),
    thumbnailUrl: swatch("800", "#e8e0cf"),
    uploadedAt: "2026-04-22T14:00:00.000Z",
    usedIn: [],
    // どのノートにも貼っていない画像 — 素材ギャラリーから読み取った文字だけで見つかる
    ocrText: "焼結温度 800℃ で 2 時間 保持 昇温速度 5℃/min",
  },
  {
    fileId: "img-whiteboard",
    name: "whiteboard-2026-04-18.png",
    type: "image",
    mimeType: "image/png",
    url: swatch("WB", "#dde3ea"),
    thumbnailUrl: swatch("WB", "#dde3ea"),
    uploadedAt: "2026-04-18T18:30:00.000Z",
    usedIn: [{ noteId: "n-design-misc", noteTitle: "Design notes — UI スパイク", blockId: "b2" }],
    ocrText:
      "焼結条件の比較 A: 800℃/2h  B: 850℃/1h  C: 900℃/30min — B が最も緻密という所感",
  },
];

const sampleMediaIndex: MediaIndex = {
  version: 5,
  updatedAt: "2026-04-25T10:00:00.000Z",
  media: sampleMedia,
};

function Harness({ showDiscoveryCards = false, withSearch = false, initialPrompt = "" }: Args) {
  const [mode, setMode] = useState<ComposerMode>("ask");
  const [prompt, setPrompt] = useState(initialPrompt);
  const [log, setLog] = useState<string[]>([]);

  const sampleCards: DiscoveryCard[] = showDiscoveryCards
    ? [
        {
          id: "continue",
          title: "続きを書く",
          hint: "直前の段落を踏まえた次の一文",
          action: { kind: "continue-writing" },
        },
        {
          id: "summarize",
          title: "このノートを要約する",
          hint: "見出し単位で 3 行にまとめる",
          action: { kind: "summarize-note" },
        },
        {
          id: "visualize",
          title: "PROV を可視化",
          hint: "現在のノートの来歴グラフを開く",
          action: { kind: "visualize-prov" },
        },
        {
          id: "claim",
          title: "Concept Wiki を作る",
          hint: "頻出キーワードから Concept ノートを下書き",
          action: { kind: "make-concept-wiki" },
        },
      ]
    : [];

  return (
    <LocaleProvider>
      <div
        style={{
          background: "var(--paper-2)",
          height: "100dvh",
          padding: 32,
          fontFamily: "var(--ui)",
          color: "var(--ink-2)",
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        <p style={{ marginTop: 0 }}>
          背景はエディタを想定した紙面。Composer がオーバーレイで表示されている状態を常時レンダリング。
        </p>
        {log.length > 0 && (
          <ul style={{ marginTop: 12, paddingLeft: 16 }}>
            {log.map((l, i) => (
              <li key={i} style={{ fontFamily: "ui-monospace, 'SF Mono', monospace", fontSize: 12 }}>
                {l}
              </li>
            ))}
          </ul>
        )}
        <Composer
          open
          mode={mode}
          onModeChange={setMode}
          prompt={prompt}
          onPromptChange={setPrompt}
          onSubmit={(submission: ComposerSubmission) => {
            setLog((prev) => [...prev, `submit: mode=${submission.mode}, prompt="${submission.prompt}"`]);
            setPrompt("");
          }}
          onClose={() => setLog((prev) => [...prev, "close (dismissed)"])}
          discoveryCards={sampleCards}
          onDiscoveryCardSelect={(card) =>
            setLog((prev) => [...prev, `card: ${card.id} (${card.action.kind})`])
          }
          noteIndex={withSearch ? sampleIndex : null}
          onNoteSelect={
            withSearch
              ? (noteId, source) =>
                  setLog((prev) => [...prev, `open note: ${noteId} (source=${source ?? "human"})`])
              : undefined
          }
          mediaIndex={withSearch ? sampleMediaIndex : null}
          onMediaSelect={
            withSearch
              ? (entry) => setLog((prev) => [...prev, `open material peek: ${entry.name}`])
              : undefined
          }
        />
      </div>
    </LocaleProvider>
  );
}

export const Default: StoryObj<Args> = {
  name: "初期状態（入力のみ）",
  render: (args) => <Harness {...args} />,
  args: {},
};

export const WithDiscoveryCards: StoryObj<Args> = {
  name: "発見カード付き",
  render: (args) => <Harness {...args} />,
  args: { showDiscoveryCards: true },
};

export const SearchEmpty: StoryObj<Args> = {
  name: "検索 — 入力空（直近のノート）",
  render: (args) => <Harness {...args} />,
  args: { withSearch: true },
};

export const SearchTitle: StoryObj<Args> = {
  name: "検索 — タイトル一致",
  render: (args) => <Harness {...args} />,
  args: { withSearch: true, initialPrompt: "xrd" },
};

export const SearchLabelFilter: StoryObj<Args> = {
  name: "検索 — #ラベルで絞り込み",
  render: (args) => <Harness {...args} />,
  args: { withSearch: true, initialPrompt: "#procedure" },
};

export const SearchAuthorFilter: StoryObj<Args> = {
  name: "検索 — @作者で絞り込み",
  render: (args) => <Harness {...args} />,
  args: { withSearch: true, initialPrompt: "@claude" },
};

export const SearchNoMatch: StoryObj<Args> = {
  name: "検索 — 一致なし（AI に倒れる）",
  render: (args) => <Harness {...args} />,
  args: { withSearch: true, initialPrompt: "ZZZ unknown query" },
};

export const SearchImageOcr: StoryObj<Args> = {
  name: "検索 — 画像の中の文字で当たる",
  render: (args) => <Harness {...args} />,
  args: { withSearch: true, initialPrompt: "焼結" },
  parameters: {
    docs: {
      description: {
        story:
          "OCR で読み取った画像内の文字に一致した例。ノートのタイトルには「焼結」が無いので、結果は画像セクションだけになる。ノートに貼った画像も、どのノートにも貼っていない画像も同じように並ぶ。",
      },
    },
  },
};

export const SearchNotesAndImages: StoryObj<Args> = {
  name: "検索 — ノートと画像が両方当たる",
  render: (args) => <Harness {...args} />,
  args: { withSearch: true, initialPrompt: "XRD" },
  parameters: {
    docs: {
      description: {
        story:
          "ノート（タイトル・見出し一致）の下に画像セクションが並ぶ。画像はファイル名でも画像内の文字でも当たる。",
      },
    },
  },
};
