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

const ALL_ENTRIES = {
  entries: {
    note: NOTES,
    knowledge: KNOWLEDGE,
    reference: REFERENCES,
    "data-manifest": DATA_MANIFESTS,
    template: TEMPLATES,
    report: [],
    comment: COMMENTS,
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
const makeDoc = (title: string, blocks: any[]): GraphiumDocument =>
  ({
    version: 6,
    title,
    pages: [{ id: "p1", title, blocks, labels: {}, provLinks: [], knowledgeLinks: [] }],
  }) as any;

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
