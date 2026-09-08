// Shared Library ビューの Storybook ストーリー（表形式版・#カードグリッドからの置き換え）
//
// 研究室の「先生と学生」の場面を想定したモックデータ:
// - currentIdentity は先生（山田先生）
// - ノート 4 件（学生 2 人 + 先生 1 人、うち 1 件は version 2）。3 件は共有時点のフォルダ付き、1 件は無し
//   うち 2 件はノート内に貼られた画像・ファイル（extra.blobs）を持つ。素材タブに仮想行として並ぶ
//   （1 つは 2 件のノートに貼られた同じ画像＝ hash が同じなので 1 行に畳まれる）
// - ナレッジ 2 件（wikiKind "summary" / "atom"）
// - reference 2 件（URL ブックマーク）
// - data-manifest 3 件（image / pdf / data）
//
// 詳細パネルは Tauri の invoke（provider.read）に依存するため、Storybook 上では
// 本文を読み込めない（読み込み中のまま止まる）。行クリックでの選択表示自体は確認できる。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider, syncLocale } from "../../i18n";
import type { SharedEntry } from "../../lib/storage/shared";
import { SharedLibraryView } from "./SharedLibraryView";
import {
  __resetSharedProjectionForTest,
  recordSharedProjectionFromBody,
} from "./shared-projection";
import { SharedEntryComments } from "./SharedEntryComments";
import { markSeen } from "./shared-seen";
import type { GraphiumDocument } from "../../lib/document-types";
import "../../app.css";

const now = new Date();
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400_000).toISOString();

const TEACHER = { name: "山田 先生", email: "yamada@example.ac.jp" };
const STUDENT_A = { name: "佐藤 学生", email: "sato@example.ac.jp" };
const STUDENT_B = { name: "鈴木 学生", email: "suzuki@example.ac.jp" };

function makeEntry(partial: Partial<SharedEntry> & Pick<SharedEntry, "id" | "type" | "author">): SharedEntry {
  return {
    created_at: daysAgo(10),
    updated_at: daysAgo(1),
    hash: `sha256:${"a".repeat(56)}${partial.id}`.slice(0, 71),
    prov: { derived_from: [] },
    version: 1,
    ...partial,
  };
}

/** ノート本文に貼られた画像・ファイル（共有時に extra.blobs へ書かれる BlobRef） */
const blob = (hash: string, filename: string | undefined, size: number) => ({
  provider: "local-folder",
  uri: `file:///Users/yamada/shared-blobs/${hash}`,
  hash: `sha256:${hash}`,
  size,
  ...(filename ? { filename } : {}),
});

// note-1 と note-3 に同じ SEM 画像が貼られている（同じ hash ＝ 素材タブでは 1 行）
const SEM_BLOB = blob("b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8", "sem_grain.png", 842_000);

const NOTES: SharedEntry[] = [
  makeEntry({
    id: "note-1",
    type: "note",
    author: STUDENT_A,
    updated_at: daysAgo(0.2),
    extra: {
      title: "Cu粉末の焼結実験（第1回）",
      noteContexts: ["卒論/焼結"],
      // 画像 + 表計算 + 題名を持たない古い共有（hash 先頭 12 桁で出る）
      blobs: [
        SEM_BLOB,
        blob("0a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5061728394a5b", "焼結条件.xlsx", 21_000),
        blob("ff00112233445566778899aabbccddeeff00112233445566778899aa", undefined, 5_400),
      ],
    },
  }),
  makeEntry({
    id: "note-2",
    type: "note",
    author: STUDENT_A,
    updated_at: daysAgo(1),
    version: 2,
    extra: { title: "シリカ管の前処理手順", noteContexts: ["共通/装置"] },
  }),
  makeEntry({
    id: "note-3",
    type: "note",
    author: STUDENT_B,
    updated_at: daysAgo(3),
    extra: {
      title: "XRD 分析結果まとめ",
      noteContexts: ["卒論/焼結", "共通/装置"],
      // note-1 と同じ画像（出どころ列が「2 件のノート」になる）+ 音声メモ
      blobs: [SEM_BLOB, blob("aabbccddeeff00112233445566778899aabbccddeeff001122334455", "討議メモ.m4a", 1_200_000)],
    },
  }),
  makeEntry({
    id: "note-4",
    type: "note",
    author: TEACHER,
    updated_at: daysAgo(5),
    extra: { title: "実験ノートの書き方（テンプレート）" },
  }),
];

const KNOWLEDGE: SharedEntry[] = [
  makeEntry({
    id: "knowledge-1",
    type: "knowledge",
    author: STUDENT_B,
    updated_at: daysAgo(2),
    extra: { title: "焼結温度と密度の関係", wikiKind: "summary" },
  }),
  makeEntry({
    id: "knowledge-2",
    type: "knowledge",
    author: TEACHER,
    updated_at: daysAgo(6),
    extra: { title: "Cu2O 相の生成条件", wikiKind: "atom" },
  }),
];

const REFERENCES: SharedEntry[] = [
  makeEntry({
    id: "ref-1",
    type: "reference",
    author: STUDENT_A,
    updated_at: daysAgo(4),
    extra: {
      title: "Sintering Behavior of Copper Powders",
      url: "https://example.org/papers/cu-sintering",
      domain: "example.org",
      description: "焼結条件の先行研究レビュー",
    },
  }),
  makeEntry({
    id: "ref-2",
    type: "reference",
    author: TEACHER,
    updated_at: daysAgo(8),
    extra: {
      title: "XRD 解析ソフトの使い方",
      url: "https://example.org/xrd-manual",
      domain: "example.org",
    },
  }),
];

const DATA_MANIFESTS: SharedEntry[] = [
  makeEntry({
    id: "data-1",
    type: "data-manifest",
    author: STUDENT_B,
    updated_at: daysAgo(0.5),
    extra: {
      title: "焼結体断面 SEM 画像",
      media_type: "image",
      mime_type: "image/png",
      original_filename: "sem_cross_section.png",
    },
  }),
  makeEntry({
    id: "data-2",
    type: "data-manifest",
    author: STUDENT_A,
    updated_at: daysAgo(2),
    extra: {
      title: "実験データシート（第1回〜第3回）",
      media_type: "pdf",
      mime_type: "application/pdf",
      original_filename: "experiment_data.pdf",
    },
  }),
  makeEntry({
    id: "data-3",
    type: "data-manifest",
    author: TEACHER,
    updated_at: daysAgo(9),
    extra: {
      title: "XRD 測定生データ（CSV）",
      media_type: "data",
      mime_type: "text/csv",
      original_filename: "xrd_raw.csv",
    },
  }),
];

// テンプレート 3 件（先生 2 + 学生 1）。一覧は本文を読まずに描くので、
// 規模（stepCount / labelCount）と説明は extra から出る
const TEMPLATES: SharedEntry[] = [
  makeEntry({
    id: "template-1",
    type: "template",
    author: TEACHER,
    updated_at: daysAgo(0.8),
    extra: {
      title: "焼結実験ノートの雛形",
      description: "秤量 → 成形 → 焼結 の 3 手順と、条件を書く表が入っています。数値は空にしてあります。",
      stepCount: 3,
      labelCount: 6,
      pageTitle: "Cu粉末の焼結実験（第1回）",
    },
  }),
  makeEntry({
    id: "template-2",
    type: "template",
    author: TEACHER,
    updated_at: daysAgo(4),
    extra: {
      title: "装置の前処理チェックリスト",
      description: "洗浄・乾燥の手順。装置を使う前に必ずこの雛形からノートを作ること。",
      stepCount: 2,
      labelCount: 3,
      pageTitle: "シリカ管の前処理手順",
    },
  }),
  makeEntry({
    id: "template-3",
    type: "template",
    author: STUDENT_B,
    updated_at: daysAgo(7),
    // 説明を書かずに共有した例（説明列はダッシュになる）
    extra: {
      title: "XRD 測定の記録用",
      description: null,
      stepCount: 1,
      labelCount: 2,
      pageTitle: "XRD 分析結果まとめ",
    },
  }),
];

// 先生 → 学生のコメント（note-1 に付いた 1 スレッド + 段落付きの指摘 1 件）。
// 一覧タブには出ない（対象に付くもの）。詳細パネルの「コメント」節と行の印に効く
const COMMENTS: SharedEntry[] = [
  makeEntry({
    id: "comment-1",
    type: "comment",
    author: TEACHER,
    created_at: daysAgo(0.5),
    updated_at: daysAgo(0.5),
    prov: { derived_from: ["note-1"] },
    extra: { target: "note-1", targetHash: NOTES[0].hash },
  }),
  makeEntry({
    id: "comment-2",
    type: "comment",
    author: STUDENT_A,
    created_at: daysAgo(0.4),
    updated_at: daysAgo(0.4),
    prov: { derived_from: ["note-1"] },
    extra: { target: "note-1", targetHash: NOTES[0].hash, parentId: "comment-1" },
  }),
  makeEntry({
    id: "comment-3",
    type: "comment",
    author: TEACHER,
    created_at: daysAgo(0.3),
    updated_at: daysAgo(0.3),
    prov: { derived_from: ["note-1"] },
    extra: {
      target: "note-1",
      targetHash: NOTES[0].hash,
      blockId: "b-sinter",
      blockText: "1050 ℃ で 2 時間保持した",
    },
  }),
  // 対象が更新される前に書かれた指摘（「古い版へのコメント」に畳まれる）
  makeEntry({
    id: "comment-4",
    type: "comment",
    author: TEACHER,
    created_at: daysAgo(6),
    updated_at: daysAgo(6),
    prov: { derived_from: ["note-1"] },
    extra: { target: "note-1", targetHash: "sha256:before-the-update" },
  }),
];

const COMMENT_TEXTS: Record<string, string> = {
  "comment-1": "昇温速度が書かれていません。次回から記録してください。",
  "comment-2": "すみません、追記しました。5 ℃/min です。",
  "comment-3": "保持時間の根拠になった文献を引用で足しておくと良いです。",
  "comment-4": "図 2 の軸ラベルが読めません。",
};

// 変更の提案 2 件（§25）。どちらも先生のノート（note-4）への提案。
// 1 件は元の現在の版を土台にしたもの（受け付け中）、1 件は出したあとに元が
// 更新されたもの（元のノートがその後更新されました）。
const PROPOSALS: SharedEntry[] = [
  makeEntry({
    id: "proposal-1",
    type: "proposal",
    author: STUDENT_A,
    created_at: daysAgo(0.4),
    updated_at: daysAgo(0.4),
    prov: { derived_from: ["note-4"] },
    extra: {
      title: "実験ノートの書き方（測定値の欄を追加）",
      target: "note-4",
      targetHash: NOTES[3].hash,
      targetTitle: "実験ノートの書き方（テンプレート）",
      message: "測定値を書く欄が無かったので、表を 1 つ足しました。",
      baseRef: {
        provider: "local-folder",
        uri: "file:///Users/yamada/shared-blobs/base",
        hash: "sha256:base00001",
        size: 1_200,
      },
    },
  }),
  makeEntry({
    id: "proposal-2",
    type: "proposal",
    author: STUDENT_B,
    created_at: daysAgo(3),
    updated_at: daysAgo(3),
    prov: { derived_from: ["note-4"] },
    extra: {
      title: "実験ノートの書き方（用語をそろえた版）",
      target: "note-4",
      // 出したあとに元が更新された（元エントリの現在の hash と違う）
      targetHash: "sha256:before-the-update",
      targetTitle: "実験ノートの書き方（テンプレート）",
      message: "「試料」と「サンプル」が混ざっていたのでそろえました。",
    },
  }),
];

const ALL_ENTRIES = {
  entries: {
    note: NOTES,
    knowledge: KNOWLEDGE,
    reference: REFERENCES,
    "data-manifest": DATA_MANIFESTS,
    template: TEMPLATES,
    report: [],
    comment: COMMENTS,
    proposal: PROPOSALS,
  },
  errors: {},
};

const EMPTY_ENTRIES = {
  entries: {
    note: [],
    knowledge: [],
    reference: [],
    "data-manifest": [],
    template: [],
    report: [],
    comment: [],
    proposal: [],
  },
  errors: {},
};

const NOOP_ASYNC = async () => {};

const meta: Meta<typeof SharedLibraryView> = {
  title: "Sharing/SharedLibraryView",
  component: SharedLibraryView,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "共有ライブラリの表形式ビュー（カードグリッドからの置き換え）。ノートタブには共有した時点のフォルダ列が並ぶ（1 件はフォルダ無し ＝ 空欄）。詳細パネルは Tauri の invoke に依存するため、Storybook 上では本文を読み込めない（読み込み中のまま止まる）。",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof SharedLibraryView>;

const baseArgs = {
  sharedRoot: "/Users/yamada/shared-lab",
  currentIdentity: TEACHER,
  onForkNote: NOOP_ASYNC,
  onForkKnowledge: NOOP_ASYNC,
  onCreateNoteFromTemplate: NOOP_ASYNC,
  onUnshare: NOOP_ASYNC,
  onImportBlob: NOOP_ASYNC,
  onBack: () => console.log("back"),
  // 行のダブルクリック・詳細パネルの「開く」から全画面表示へ（実アプリでは SharedNoteView）
  onOpenFull: (entry: SharedEntry) => console.log("open full", entry.id),
  // ラベル / プロセスタブの説明バーのボタン（実アプリではノート一覧へ移動する）
  onOpenNoteList: () => console.log("open note list"),
  loadEntries: async () => ALL_ENTRIES,
};

export const Proposed: Story = {
  name: "提案（表・ノート）",
  args: baseArgs,
  decorators: [
    (Story) => {
      syncLocale("ja");
      return (
        <LocaleProvider>
          <div style={{ height: "100vh", display: "flex", fontFamily: "'Inter', system-ui, sans-serif" }}>
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
};

export const ProposedAssets: Story = {
  name: "提案（素材タブ）",
  args: { ...baseArgs, initialTab: "asset" },
  decorators: Proposed.decorators,
  parameters: {
    docs: {
      description: {
        story:
          "共有した素材（reference / data-manifest）に加えて、共有ノートに貼られた画像・ファイルが 📎 付きの仮想行として並ぶ。blob 行は SharedEntry ではないので版・検証・fork が無く、操作は「ノートを開く」と「自分の素材に取り込む」だけ。同じ hash の画像は 1 行に畳まれ、出どころ列が「2 件のノート」になる。",
      },
    },
  },
};

export const ProposedAssetsNoBlobRoot: Story = {
  name: "素材タブ（blob 保管先 未設定）",
  // onImportBlob が無い ＝ blob root 未設定。取り込みボタンは無効のまま行だけ出る
  args: { ...baseArgs, initialTab: "asset", onImportBlob: undefined },
  decorators: Proposed.decorators,
};

export const ProposedTemplates: Story = {
  name: "提案（テンプレートタブ）",
  args: { ...baseArgs, initialTab: "template" },
  decorators: Proposed.decorators,
  parameters: {
    docs: {
      description: {
        story:
          "共有テンプレートの一覧。列は タイトル / 説明 / 作者 / 共有日 / 版 / 検証（フォルダ列は出さない — 雛形は共有した人の整理を持ち込まない）。行の操作に「派生（fork）」は無く、詳細パネルから「テンプレートから新規ノート」で作る。",
      },
    },
  },
};

export const ProposedProposals: Story = {
  name: "変更の提案 — 一覧",
  args: { ...baseArgs, initialTab: "proposal" as const },
  decorators: Proposed.decorators,
  parameters: {
    docs: {
      description: {
        story:
          "誰かのノートへの「変更の提案」の一覧。列は タイトル / 元のノート（押すと元へ移る）/ 作者 / 共有日 / 版 / 状態。状態は封筒から毎回導き出す —— 提案が土台にした版と元の現在の版が違えば「元のノートがその後更新されました」になる。派生（fork）の操作は出さない（提案は元のノートへの差分であって、そこからさらに派生するものではない）。ノートタブの元のノートの行には「提案 2」が付く。",
      },
    },
  },
};

export const ProposedEmpty: Story = {
  name: "空",
  args: { ...baseArgs, loadEntries: async () => EMPTY_ENTRIES },
  decorators: Proposed.decorators,
};

export const ProposedEnglish: Story = {
  name: "English",
  args: baseArgs,
  decorators: [
    (Story) => {
      syncLocale("en");
      return (
        <LocaleProvider>
          <div style={{ height: "100vh", display: "flex", fontFamily: "'Inter', system-ui, sans-serif" }}>
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
};

// ── ラベル / プロセスタブ ──
//
// この 2 つのタブは共有エントリの一覧ではなく、共有ノートの本文から投影した結果を見る。
// 投影はモジュールスコープのストアに載るので、ストーリーでは実際の投影経路
// （語彙索引レーンが本文を読んだときに呼ぶ関数）に本文を流し込んで作る。
// 別経路でストアを組み立てると、実物と違う形のデータで見た目を確認することになる。

const styled = (text: string, styles: Record<string, string | boolean> = {}) => ({
  type: "text",
  text,
  styles,
});
const para = (id: string, content: any[]) => ({ id, type: "paragraph", content, children: [] });
const stepBlock = (id: string, title: string, children: any[] = []) => ({
  id,
  type: "step",
  content: [styled(title)],
  children,
});
const makeDoc = (title: string, blocks: any[], provLinks: any[] = []): GraphiumDocument =>
  ({
    version: 6,
    title,
    pages: [{ id: "p1", title, blocks, labels: {}, provLinks, knowledgeLinks: [] }],
  }) as any;

/** 前手順リンク（informed_by）。これが無いと手順フローが 1 本に繋がらない */
const informedBy = (step: string, prevStep: string) => ({
  id: `link-${step}-${prevStep}`,
  sourceBlockId: step,
  targetBlockId: prevStep,
  type: "informed_by" as const,
  layer: "prov" as const,
  createdBy: "system" as const,
});

const SINTERING_DOC = makeDoc("Cu粉末の焼結実験（第1回）", [
  stepBlock("s1", "秤量", [
    para("b1", [styled("Cu 粉末", { inlineMaterial: "mat-cu" })]),
    para("b2", [styled("電子天秤", { inlineTool: "tool-balance" })]),
  ]),
  stepBlock("s2", "成形", [
    para("b3", [styled("一軸プレス", { inlineTool: "tool-press" })]),
    para("b4", [styled("圧粉体", { inlineOutput: "out-green" })]),
  ]),
  stepBlock("s3", "焼結", [
    para("b5", [styled("管状炉", { inlineTool: "tool-furnace" })]),
    para("b6", [styled("焼結体", { inlineOutput: "out-sintered" })]),
  ]),
]);

const PRETREAT_DOC = makeDoc("シリカ管の前処理手順", [
  stepBlock("s1", "洗浄", [
    para("b1", [styled("シリカ管", { inlineMaterial: "mat-silica" })]),
    para("b2", [styled("超音波洗浄機", { inlineTool: "tool-sonic" })]),
  ]),
  stepBlock("s2", "乾燥", [para("b3", [styled("乾燥管", { inlineOutput: "out-dry" })])]),
]);

const XRD_DOC = makeDoc("XRD 分析結果まとめ", [
  stepBlock("s1", "XRD 測定", [
    para("b1", [styled("焼結体", { inlineMaterial: "mat-sintered" })]),
    para("b2", [styled("X 線回折装置", { inlineTool: "tool-xrd" })]),
    para("b3", [styled("回折パターン", { inlineOutput: "out-pattern" })]),
  ]),
]);

const encodeDoc = (doc: GraphiumDocument) => new TextEncoder().encode(JSON.stringify(doc));

/** 3 件のノートを投影済みにする（残り 1 件は「まだ本文を読めていない」状態のまま） */
function seedProjection() {
  __resetSharedProjectionForTest();
  recordSharedProjectionFromBody(NOTES[0], encodeDoc(SINTERING_DOC), true);
  recordSharedProjectionFromBody(NOTES[1], encodeDoc(PRETREAT_DOC), true);
  recordSharedProjectionFromBody(NOTES[2], encodeDoc(XRD_DOC), true);
}

const projectionDecorators = [
  (Story: () => React.JSX.Element) => {
    syncLocale("ja");
    seedProjection();
    return (
      <LocaleProvider>
        <div style={{ height: "100vh", display: "flex", fontFamily: "'Inter', system-ui, sans-serif" }}>
          <Story />
        </div>
      </LocaleProvider>
    );
  },
];

const emptyProjectionDecorators = [
  (Story: () => React.JSX.Element) => {
    syncLocale("ja");
    // 起動直後 = まだどのノートの本文も読めていない状態
    __resetSharedProjectionForTest();
    return (
      <LocaleProvider>
        <div style={{ height: "100vh", display: "flex", fontFamily: "'Inter', system-ui, sans-serif" }}>
          <Story />
        </div>
      </LocaleProvider>
    );
  },
];

export const ProposedLabels: Story = {
  name: "提案（ラベルタブ）",
  args: { ...baseArgs, initialTab: "labels" },
  decorators: projectionDecorators,
  parameters: {
    docs: {
      description: {
        story:
          "上部の説明バーは「ラベルは共有ノートから自動で集まる（専用の共有操作は無い）」ことを伝える。共有ノートから投影したラベル。チップで種別を選び、一覧は個人側の LabelGalleryView をそのまま使う（戻るボタンだけ隠す）。件数は本文を読めたノートの分だけ増える。",
      },
    },
  },
};

export const ProposedProcess: Story = {
  name: "提案（プロセスタブ）",
  args: { ...baseArgs, initialTab: "process" },
  decorators: projectionDecorators,
  parameters: {
    docs: {
      description: {
        story:
          "上部の説明バーはラベルタブと同じ（手順も共有ノートから自動で集まる）。共有ノートから投影した手順。個人側の ProcessGalleryView をそのまま使い、fork の文言だけ「自分のノートに派生」に差し替える。",
      },
    },
  },
};

export const ProposedLabelsEmpty: Story = {
  name: "ラベルタブ（投影前）",
  args: { ...baseArgs, initialTab: "labels" },
  decorators: emptyProjectionDecorators,
};

export const ProposedProcessEmpty: Story = {
  name: "プロセスタブ（投影前）",
  args: { ...baseArgs, initialTab: "process" },
  decorators: emptyProjectionDecorators,
};

// マニュアル用スクショ撮影ストーリー（英語 UI・パン作りの世界観）
// currentIdentity は指導役 Mia Tanaka、ノートは学生役 Ken Sato / Hana Ito と Mia の混在

const MANUAL_MENTOR = { name: "Mia Tanaka", email: "mia@example.org" };
const MANUAL_STUDENT_A = { name: "Ken Sato", email: "ken@example.org" };
const MANUAL_STUDENT_B = { name: "Hana Ito", email: "hana@example.org" };

const MANUAL_NOTES: SharedEntry[] = [
  makeEntry({
    id: "manual-note-1",
    type: "note",
    author: MANUAL_STUDENT_A,
    updated_at: daysAgo(0.1),
    extra: { title: "Sourdough starter log — day 3", noteContexts: ["Sourdough/Starter"] },
  }),
  makeEntry({
    id: "manual-note-2",
    type: "note",
    author: MANUAL_STUDENT_B,
    updated_at: daysAgo(0.3),
    version: 2,
    extra: { title: "Oven calibration for the deck oven", noteContexts: ["Shared/Equipment"] },
  }),
  makeEntry({
    id: "manual-note-3",
    type: "note",
    author: MANUAL_MENTOR,
    updated_at: daysAgo(1),
    extra: { title: "Weekend bake schedule", noteContexts: ["Baguette"] },
  }),
  makeEntry({
    id: "manual-note-4",
    type: "note",
    author: MANUAL_STUDENT_A,
    updated_at: daysAgo(2),
    extra: { title: "Baguette shaping notes", noteContexts: ["Baguette"] },
  }),
  makeEntry({
    id: "manual-note-5",
    type: "note",
    author: MANUAL_MENTOR,
    updated_at: daysAgo(4),
    extra: { title: "Recipe card template" },
  }),
];

const MANUAL_KNOWLEDGE: SharedEntry[] = [
  makeEntry({
    id: "manual-knowledge-1",
    type: "knowledge",
    author: MANUAL_STUDENT_B,
    updated_at: daysAgo(1.5),
    extra: { title: "Hydration and crumb structure", wikiKind: "summary" },
  }),
  makeEntry({
    id: "manual-knowledge-2",
    type: "knowledge",
    author: MANUAL_MENTOR,
    updated_at: daysAgo(5),
    extra: { title: "Ideal proofing temperature range", wikiKind: "atom" },
  }),
];

const MANUAL_REFERENCES: SharedEntry[] = [
  makeEntry({
    id: "manual-ref-1",
    type: "reference",
    author: MANUAL_STUDENT_A,
    updated_at: daysAgo(3),
    extra: {
      title: "The Chemistry of Sourdough Fermentation",
      url: "https://example.org/articles/sourdough-fermentation",
      domain: "example.org",
      description: "Background reading on wild yeast and lactic acid bacteria",
    },
  }),
  makeEntry({
    id: "manual-ref-2",
    type: "reference",
    author: MANUAL_MENTOR,
    updated_at: daysAgo(7),
    extra: {
      title: "Deck Oven Operating Manual",
      url: "https://example.org/manuals/deck-oven",
      domain: "example.org",
    },
  }),
];

const MANUAL_DATA_MANIFESTS: SharedEntry[] = [
  makeEntry({
    id: "manual-data-1",
    type: "data-manifest",
    author: MANUAL_STUDENT_B,
    updated_at: daysAgo(0.4),
    extra: {
      title: "Crumb cross-section photo",
      media_type: "image",
      mime_type: "image/png",
      original_filename: "crumb_cross_section.png",
    },
  }),
  makeEntry({
    id: "manual-data-2",
    type: "data-manifest",
    author: MANUAL_STUDENT_A,
    updated_at: daysAgo(1.5),
    extra: {
      title: "Bake log sheet (week 1–3)",
      media_type: "pdf",
      mime_type: "application/pdf",
      original_filename: "bake_log.pdf",
    },
  }),
  makeEntry({
    id: "manual-data-3",
    type: "data-manifest",
    author: MANUAL_MENTOR,
    updated_at: daysAgo(8),
    extra: {
      title: "Oven temperature readings (CSV)",
      media_type: "data",
      mime_type: "text/csv",
      original_filename: "oven_temps.csv",
    },
  }),
];

const MANUAL_ENTRIES = {
  entries: {
    note: MANUAL_NOTES,
    knowledge: MANUAL_KNOWLEDGE,
    reference: MANUAL_REFERENCES,
    "data-manifest": MANUAL_DATA_MANIFESTS,
    template: [],
    report: [],
    comment: [],
    proposal: [],
  },
  errors: {},
};

export const ManualEnglish: Story = {
  name: "Manual (English, bread world)",
  args: {
    ...baseArgs,
    sharedRoot: "/Users/mia/shared-bakery",
    currentIdentity: MANUAL_MENTOR,
    loadEntries: async () => MANUAL_ENTRIES,
  },
  decorators: [
    (Story) => {
      syncLocale("en");
      return (
        <LocaleProvider>
          <div style={{ height: "100vh", display: "flex", fontFamily: "'Inter', system-ui, sans-serif" }}>
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
};

// ── 先生 ⇄ 学生の往復（コメント・更新あり・新着の印） ──
// 共有フォルダは Tauri の invoke 越しなので、Storybook では封筒も本文もモックで渡す。

/** 「最後に見た」控えを仕込む（前に見たのは古い版・コメントは 1 件だけ見ていた） */
function seedSeen() {
  markSeen("note-1", "sha256:the-version-i-saw-before", 1);
}

export const ProposedUpdateMarks: Story = {
  name: "提案（更新あり・新着コメントの印）",
  args: baseArgs,
  decorators: [
    (Story) => {
      syncLocale("ja");
      seedSeen();
      return (
        <LocaleProvider>
          <div style={{ height: "100vh", display: "flex", fontFamily: "'Inter', system-ui, sans-serif" }}>
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
  parameters: {
    docs: {
      description: {
        story:
          "前に見たときから hash が変わった他人のノートに「更新あり」、控えより増えたコメントに「新着 N」を出す。自分作のノートと、まだ一度も開いていないノートには印を出さない（全部に印が付くとノイズになる）。版列は同じ id を上書きした回数を「v1 · 更新 N 回」で見せる。",
      },
    },
  },
};

/** 詳細パネルの「コメント」節だけを切り出したストーリー（本文は DI で渡す） */
export const DetailComments: Story = {
  name: "提案（詳細パネルのコメント節）",
  parameters: {
    layout: "centered",
    docs: {
      description: {
        story:
          "対象 1 件に付いたコメント。返信は 1 段まで。段落に付いた指摘は ¶ チップで出し、押すとプレビューの該当ブロックへ飛ぶ。共有コピーが更新される前に書かれた指摘は「古い版へのコメント」に畳まれる（解決フラグを持たない代わり）。",
      },
    },
  },
  render: () => {
    syncLocale("ja");
    return (
      <LocaleProvider>
        <div style={{ width: 420, fontFamily: "'Inter', system-ui, sans-serif" }}>
          <SharedEntryComments
            targetId="note-1"
            targetHash={NOTES[0].hash}
            sharedRoot="/Users/yamada/shared-lab"
            currentIdentity={TEACHER}
            entries={COMMENTS}
            readBody={async (entry) => ({
              body: new TextEncoder().encode(COMMENT_TEXTS[entry.id] ?? ""),
              verified: true,
            })}
            pendingAnchor={{ blockId: "b-sinter", blockText: "1050 ℃ で 2 時間保持した" }}
            onClearAnchor={() => console.log("clear anchor")}
            onJumpToBlock={(blockId) => console.log("jump to", blockId)}
            provider={{
              read: async () => {
                throw new Error("storybook mock");
              },
              write: async (entry, content) =>
                console.log("write", entry.id, new TextDecoder().decode(content)),
              delete: async (id) => console.log("delete", id),
            }}
          />
        </div>
      </LocaleProvider>
    );
  },
};

// ── 詳細パネル（プレビュー + コメントのドック） ──
//
// 実アプリの本文は Tauri の invoke 越しなので、Storybook では readEntryBody を
// 差し替えて擬似 GraphiumDocument を返す（loadEntries と同じ DI の流儀）。
// プレビューの段落をクリックすると ¶ の指定が付き、その段落が常時ハイライトされる。

const DETAIL_DOC = makeDoc("Cu粉末の焼結実験（第1回）", [
  para("b-weigh", [styled("Cu 粉末を 5.00 g 秤量した（電子天秤 0.01 g 読み）。")]),
  para("b-press", [styled("一軸プレスで 200 MPa・60 秒 保持して圧粉体を作製した。")]),
  para("b-sinter", [styled("1050 ℃ で 2 時間保持した")]),
  para("b-cool", [styled("炉冷（自然冷却）。翌朝に取り出した。")]),
  para("b-xrd", [styled("焼結体を XRD で測定し、Cu2O のピークを確認した。")]),
]);

export const ProposedDetailWithComments: Story = {
  name: "提案（詳細パネル・コメントのドック）",
  args: {
    ...baseArgs,
    // 一覧から選んだのと同じ状態（note-1 の詳細パネルを開いた状態）で始める
    focusEntryId: "note-1",
    readEntryBody: async (entry) => ({
      body:
        entry.type === "comment"
          ? new TextEncoder().encode(COMMENT_TEXTS[entry.id] ?? "")
          : encodeDoc(DETAIL_DOC),
      verified: true,
    }),
  },
  decorators: Proposed.decorators,
  parameters: {
    docs: {
      description: {
        story:
          "コメントはパネル下部に固定（ドック）する。見出し行で一覧を畳めるが、入力欄は畳んでも残るので、上の方の段落を選んでから下まで戻る必要がない。プレビューの段落をクリックすると ¶ の指定が付き、その段落がノート編集画面の履歴ハイライトと同じ見た目で強調される（もう一度クリックで解除）。見出し右の「開く」（⤢）で全画面表示に移る（一覧の行をダブルクリックしても同じ）。",
      },
    },
  },
};

// ── マニュアル用スクショ（英語・パン作りの世界観）: ラベル / プロセス / テンプレート / 印 / コメント ──
//
// 撮影は scripts/manual-screenshots-shared.mjs（Storybook の iframe.html を Playwright で開く）。
// 上の ManualEnglish と同じ登場人物・同じフォルダを使い、DI の組み方は日本語ストーリー
// （ProposedLabels / ProposedProcess / ProposedTemplates / ProposedUpdateMarks /
// ProposedDetailWithComments）と同じにする。中身だけをパン作りに置き換えたもの。

/** テンプレートタブ用。説明列が埋まる 2 件（片方は指導役、片方は学生役） */
const MANUAL_TEMPLATES: SharedEntry[] = [
  makeEntry({
    id: "manual-template-1",
    type: "template",
    author: MANUAL_MENTOR,
    updated_at: daysAgo(0.6),
    extra: {
      title: "Bake log template",
      description:
        "Mix → Ferment → Bake, with a table for dough temperature and timings. The numbers are left blank.",
      stepCount: 3,
      labelCount: 6,
      pageTitle: "Weekend bake schedule",
    },
  }),
  makeEntry({
    id: "manual-template-2",
    type: "template",
    author: MANUAL_STUDENT_B,
    updated_at: daysAgo(2.5),
    extra: {
      title: "Starter feeding sheet",
      description:
        "One row per feeding: flour, water, room temperature, and how far the starter rose.",
      stepCount: 2,
      labelCount: 4,
      pageTitle: "Sourdough starter log — day 3",
    },
  }),
];

/** manual-note-1 に付いたコメント（返信 1 件 + 段落付きの指摘 1 件） */
const MANUAL_COMMENTS: SharedEntry[] = [
  makeEntry({
    id: "manual-comment-1",
    type: "comment",
    author: MANUAL_MENTOR,
    created_at: daysAgo(0.35),
    updated_at: daysAgo(0.35),
    prov: { derived_from: ["manual-note-1"] },
    extra: { target: "manual-note-1", targetHash: MANUAL_NOTES[0].hash },
  }),
  makeEntry({
    id: "manual-comment-2",
    type: "comment",
    author: MANUAL_STUDENT_A,
    created_at: daysAgo(0.3),
    updated_at: daysAgo(0.3),
    prov: { derived_from: ["manual-note-1"] },
    extra: {
      target: "manual-note-1",
      targetHash: MANUAL_NOTES[0].hash,
      parentId: "manual-comment-1",
    },
  }),
  makeEntry({
    id: "manual-comment-3",
    type: "comment",
    author: MANUAL_MENTOR,
    created_at: daysAgo(0.2),
    updated_at: daysAgo(0.2),
    prov: { derived_from: ["manual-note-1"] },
    extra: {
      target: "manual-note-1",
      targetHash: MANUAL_NOTES[0].hash,
      blockId: "mb-rise",
      blockText: "The starter doubled in four hours at 28 °C.",
    },
  }),
];

const MANUAL_COMMENT_TEXTS: Record<string, string> = {
  "manual-comment-1":
    "Good rise. Could you also write down the room temperature at every feeding?",
  "manual-comment-2": "Added it — 21 °C in the kitchen, 28 °C in the proofing box.",
  "manual-comment-3":
    "Worth linking the hydration page here: day 2 rose much more slowly at the same temperature.",
};

/** ManualEnglish の一覧にテンプレートとコメントを足したもの（既存の MANUAL_ENTRIES は触らない） */
const MANUAL_ENTRIES_WITH_REPLIES = {
  entries: {
    note: MANUAL_NOTES,
    knowledge: MANUAL_KNOWLEDGE,
    reference: MANUAL_REFERENCES,
    "data-manifest": MANUAL_DATA_MANIFESTS,
    template: MANUAL_TEMPLATES,
    report: [],
    comment: MANUAL_COMMENTS,
    proposal: [],
  },
  errors: {},
};

// 投影に流し込む本文。ラベルタブは inline ハイライトから、プロセスタブは step ブロックから出る
const MANUAL_STARTER_DOC = makeDoc("Sourdough starter log — day 3", [
  para("mb-flour", [styled("bread flour 500 g", { inlineMaterial: "mat-bread-flour" })]),
  para("mb-rye", [styled("rye flour 50 g", { inlineMaterial: "mat-rye-flour" })]),
  para("mb-whole", [styled("whole wheat flour 100 g", { inlineMaterial: "mat-whole-wheat" })]),
  para("mb-water", [styled("water 350 g", { inlineMaterial: "mat-water" })]),
  para("mb-levain", [styled("levain 100 g", { inlineMaterial: "mat-levain" })]),
  para("mb-poolish", [styled("poolish 200 g", { inlineMaterial: "mat-poolish" })]),
  para("mb-scale", [styled("kitchen scale", { inlineTool: "tool-scale" })]),
  para("mb-proof", [styled("28 °C, 4 h", { inlineAttribute: "attr-proof" })]),
]);

// 各手順の出力を 1 つにして前手順リンクを張ると、次の手順が前の出力を「使った」形に
// 繋がる（generator.ts の informed_by 経路）。Mix → Ferment → Bake が 1 本の流れになる。
// 先頭の手順に入力を並べすぎると、フロー最上段が右上の「Tidy up / Parameters」の
// ツールバーに潜り込んで図が読めなくなるので、Mix の入力は 1 つに絞ってある
const MANUAL_SCHEDULE_DOC = makeDoc(
  "Weekend bake schedule",
  [
    stepBlock("ms1", "Mix", [
      para("ms1-b1", [styled("bread flour 500 g", { inlineMaterial: "mat-bread-flour" })]),
      para("ms1-b2", [styled("mixed dough", { inlineOutput: "out-mixed" })]),
    ]),
    stepBlock("ms2", "Ferment", [
      para("ms2-b1", [styled("28 °C, 4 h", { inlineAttribute: "attr-proof" })]),
      para("ms2-b2", [styled("bulk dough", { inlineOutput: "out-bulk" })]),
    ]),
    stepBlock("ms3", "Bake", [
      para("ms3-b1", [styled("deck oven", { inlineTool: "tool-deck-oven" })]),
      para("ms3-b2", [styled("240 °C", { inlineAttribute: "attr-bake-temp" })]),
      para("ms3-b3", [styled("loaf volume 1.8 L", { inlineOutput: "out-loaf" })]),
    ]),
  ],
  [informedBy("ms2", "ms1"), informedBy("ms3", "ms2")],
);

const MANUAL_SHAPING_DOC = makeDoc(
  "Baguette shaping notes",
  [
    stepBlock("mp1", "Divide", [
      para("mp1-b1", [styled("bulk dough", { inlineMaterial: "mat-bulk" })]),
      para("mp1-b2", [styled("bench scraper", { inlineTool: "tool-scraper" })]),
      para("mp1-b3", [styled("divided dough", { inlineOutput: "out-divided" })]),
    ]),
    stepBlock("mp2", "Shape", [
      para("mp2-b1", [styled("couche linen", { inlineTool: "tool-couche" })]),
      para("mp2-b2", [styled("shaped baguette", { inlineOutput: "out-shaped" })]),
    ]),
    stepBlock("mp3", "Proof", [
      para("mp3-b1", [styled("75 % humidity", { inlineAttribute: "attr-humidity" })]),
      para("mp3-b2", [styled("proofed baguette", { inlineOutput: "out-proofed" })]),
    ]),
  ],
  [informedBy("mp2", "mp1"), informedBy("mp3", "mp2")],
);

/** 3 件のノートを投影済みにする（残り 2 件は「まだ本文を読めていない」状態のまま） */
function seedManualProjection() {
  __resetSharedProjectionForTest();
  recordSharedProjectionFromBody(MANUAL_NOTES[0], encodeDoc(MANUAL_STARTER_DOC), true);
  recordSharedProjectionFromBody(MANUAL_NOTES[2], encodeDoc(MANUAL_SCHEDULE_DOC), true);
  recordSharedProjectionFromBody(MANUAL_NOTES[3], encodeDoc(MANUAL_SHAPING_DOC), true);
}

const manualDecorators = [
  (Story: () => React.JSX.Element) => {
    syncLocale("en");
    // どの図でもタブの件数（ラベル / プロセス）が同じに見えるよう、投影は常に仕込む
    seedManualProjection();
    return (
      <LocaleProvider>
        <div style={{ height: "100vh", display: "flex", fontFamily: "'Inter', system-ui, sans-serif" }}>
          <Story />
        </div>
      </LocaleProvider>
    );
  },
];

const manualProjectionDecorators = [
  (Story: () => React.JSX.Element) => {
    syncLocale("en");
    seedManualProjection();
    return (
      <LocaleProvider>
        <div style={{ height: "100vh", display: "flex", fontFamily: "'Inter', system-ui, sans-serif" }}>
          <Story />
        </div>
      </LocaleProvider>
    );
  },
];

const manualArgs = {
  ...baseArgs,
  sharedRoot: "/Users/mia/shared-bakery",
  currentIdentity: MANUAL_MENTOR,
  loadEntries: async () => MANUAL_ENTRIES_WITH_REPLIES,
};

export const ManualEnglishLabels: Story = {
  name: "Manual (English, bread world) — labels",
  args: { ...manualArgs, initialTab: "labels" },
  decorators: manualProjectionDecorators,
};

export const ManualEnglishProcess: Story = {
  name: "Manual (English, bread world) — process",
  args: { ...manualArgs, initialTab: "process" },
  decorators: manualProjectionDecorators,
};

export const ManualEnglishTemplates: Story = {
  name: "Manual (English, bread world) — templates",
  args: { ...manualArgs, initialTab: "template" },
  decorators: manualDecorators,
};

/**
 * 「最後に見た」控えを仕込む（ProposedUpdateMarks の seedSeen と同じ組み方）。
 * - manual-note-1: 同じ hash・コメント 1 件だけ見ていた → 「2 new」だけが出る
 * - manual-note-2: 古い hash を見ていた → 「Updated」だけが出る
 */
function seedManualSeen() {
  markSeen("manual-note-1", MANUAL_NOTES[0].hash, 1);
  markSeen("manual-note-2", "sha256:the-version-i-saw-before", 0);
}

/**
 * 版列に「v2 · 2 updates」を出すための更新履歴。既存の MANUAL_NOTES は触らず、
 * この図のためだけに 1 件を複製して履歴を足す（ManualEnglish の図と食い違わせない）
 */
const MANUAL_NOTES_WITH_HISTORY: SharedEntry[] = MANUAL_NOTES.map((note) =>
  note.id === "manual-note-2"
    ? {
        ...note,
        history: [
          {
            hash: "sha256:41c7be08",
            updated_at: daysAgo(1.4),
            updated_by: MANUAL_STUDENT_B,
            change_kind: "minor" as const,
          },
          {
            hash: note.hash,
            updated_at: daysAgo(0.3),
            updated_by: MANUAL_STUDENT_B,
            change_kind: "minor" as const,
          },
        ],
      }
    : note,
);

export const ManualEnglishUpdateMarks: Story = {
  name: "Manual (English, bread world) — update marks",
  args: {
    ...manualArgs,
    loadEntries: async () => ({
      ...MANUAL_ENTRIES_WITH_REPLIES,
      entries: { ...MANUAL_ENTRIES_WITH_REPLIES.entries, note: MANUAL_NOTES_WITH_HISTORY },
    }),
  },
  decorators: [
    (Story) => {
      syncLocale("en");
      seedManualProjection();
      seedManualSeen();
      return (
        <LocaleProvider>
          <div style={{ height: "100vh", display: "flex", fontFamily: "'Inter', system-ui, sans-serif" }}>
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
};

/** 詳細パネルのプレビューに出す本文（段落 mb-rise に ¶ 付きのコメントが刺さる） */
const MANUAL_DETAIL_DOC = makeDoc("Sourdough starter log — day 3", [
  para("mb-feed", [
    styled("Fed the starter at 8:00 with 50 g of bread flour and 50 g of water (1:1:1)."),
  ]),
  para("mb-box", [
    styled("Kept it in the proofing box at 28 °C; the kitchen itself stayed around 21 °C."),
  ]),
  para("mb-rise", [styled("The starter doubled in four hours at 28 °C.")]),
  para("mb-smell", [
    styled("The smell has moved from sharp vinegar to something closer to yogurt."),
  ]),
  para("mb-next", [
    styled("Day 4: feed twice, and save the discard for the weekend baguettes."),
  ]),
]);

export const ManualEnglishDetailComments: Story = {
  name: "Manual (English, bread world) — detail comments",
  args: {
    ...manualArgs,
    // 一覧から行を選んだのと同じ状態（manual-note-1 の詳細パネルを開いた状態）で始める
    focusEntryId: "manual-note-1",
    readEntryBody: async (entry) => ({
      body:
        entry.type === "comment"
          ? new TextEncoder().encode(MANUAL_COMMENT_TEXTS[entry.id] ?? "")
          : encodeDoc(MANUAL_DETAIL_DOC),
      verified: true,
    }),
  },
  decorators: manualDecorators,
};
