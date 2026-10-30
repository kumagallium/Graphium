// 素材ギャラリー（ドキュメント）の Storybook ストーリー
//
// 一覧の上の絞り込みチップ（すべて / PDF / Word / Excel / PowerPoint）の見え方を確かめる。
// - チップは拡張子ではなく資料の種類で並べる（.doc / .xls / .ppt も同じ種類に入る）
// - 1 件も無い種類のチップは出さない
// - 「Manual (English, bread world)」はマニュアルの図（material-gallery.png）の撮影用
//
// ドキュメントのサムネイルはアイコンだけなので、ストレージプロバイダ無しで描ける。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider, syncLocale } from "../../i18n";
import { AssetGalleryView } from "./AssetGalleryView";
import type { MediaIndex, MediaIndexEntry, MediaUsage } from "./media-index";
import { primeAssetText, clearAssetTextCache } from "../data-import/asset-text";
import { clearDataPreviewCache } from "../../blocks/chart/data-preview-store";
import "../../app.css";

const MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
} as const;

const now = new Date();
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400_000).toISOString();

function docEntry(
  fileId: string,
  name: string,
  mimeType: string,
  days: number,
  extra: { usedIn?: MediaUsage[]; noteContexts?: string[]; pageCount?: number } = {},
): MediaIndexEntry {
  return {
    fileId,
    name,
    type: mimeType === MIME.pdf ? "pdf" : "document",
    mimeType,
    url: "",
    thumbnailUrl: "",
    uploadedAt: daysAgo(days),
    usedIn: extra.usedIn ?? [],
    noteContexts: extra.noteContexts,
    pageCount: extra.pageCount,
  };
}

const use = (noteId: string, noteTitle: string): MediaUsage => ({ noteId, noteTitle, blockId: `${noteId}-b` });

function indexOf(media: MediaIndexEntry[]): MediaIndex {
  return { version: 9, updatedAt: now.toISOString(), media };
}

// ── 研究室の場面（日本語）: 5 種類そろい、旧形式も混じる ──
const LAB_DOCS: MediaIndexEntry[] = [
  docEntry("pdf-1", "Cu粉末焼結_文献レビュー.pdf", MIME.pdf, 1, {
    usedIn: [use("n1", "Cu粉末の焼結実験（第1回）"), use("n2", "文献レビュー: Cu焼結の最適条件")],
    noteContexts: ["2026/焼結"],
  }),
  docEntry("pdf-2", "XRD装置マニュアル.pdf", MIME.pdf, 12, { noteContexts: ["共通/装置"] }),
  docEntry("docx-1", "焼結実験_報告書.docx", MIME.docx, 2, { noteContexts: ["2026/焼結"] }),
  docEntry("doc-1", "旧_実験計画書.doc", MIME.doc, 40),
  docEntry("xlsx-1", "焼結条件と密度.xlsx", MIME.xlsx, 3, {
    usedIn: [use("n1", "Cu粉末の焼結実験（第1回）")],
    noteContexts: ["2026/焼結"],
  }),
  docEntry("xls-1", "2019_測定記録.xls", MIME.xls, 60, { noteContexts: ["2019/測定"] }),
  docEntry("pptx-1", "学会発表_2026秋.pptx", MIME.pptx, 5, { noteContexts: ["2026/学会"] }),
];

// ── パン作りの場面（英語）: マニュアルの図 ──
// ページ数はマニュアルの「ページ数で並べる」の図に出す（Excel は数えないので「—」のまま）
const BREAD_DOCS: MediaIndexEntry[] = [
  docEntry("pdf-1", "proofing-guide.pdf", MIME.pdf, 1, {
    usedIn: [use("n1", "Weekend sourdough bake"), use("n2", "Starter feeding log")],
    noteContexts: ["Sourdough"],
    pageCount: 12,
  }),
  docEntry("pdf-2", "bread-science.pdf", MIME.pdf, 6, { usedIn: [use("n1", "Weekend sourdough bake")], pageCount: 48 }),
  docEntry("docx-1", "shaping-notes.docx", MIME.docx, 2, { noteContexts: ["Baguette"], pageCount: 3 }),
  docEntry("xlsx-1", "hydration-log.xlsx", MIME.xlsx, 3, {
    usedIn: [use("n2", "Starter feeding log")],
    noteContexts: ["Sourdough/Starter"],
  }),
  docEntry("xlsx-2", "oven-readings.xlsx", MIME.xlsx, 9, { noteContexts: ["Shared/Equipment"] }),
  docEntry("pptx-1", "baking-workshop.pptx", MIME.pptx, 4, { pageCount: 18 }),
];

const meta = {
  title: "AssetBrowser/AssetGalleryView",
  component: AssetGalleryView,
  parameters: { layout: "fullscreen" },
  args: {
    mediaIndex: indexOf(LAB_DOCS),
    mediaType: "document",
    onBack: () => {},
    onNavigateNote: () => {},
    onDeleteMedia: async () => {},
    onRenameMedia: async () => {},
    // 右上の「…」メニュー（Word / PDF を追加）を出すため。ストーリーでは何もしない
    onUploadMedia: async () => "",
  },
  decorators: [
    (Story) => (
      <div style={{ height: "100vh", display: "flex" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AssetGalleryView>;

export default meta;
type Story = StoryObj<typeof meta>;

// 表示言語をデータの言語にそろえる（別のストーリーで切り替えた言語を持ち越さない）
function localeDecorator(locale: "ja" | "en") {
  return (Story: () => React.ReactElement) => {
    syncLocale(locale);
    return (
      <LocaleProvider>
        <Story />
      </LocaleProvider>
    );
  };
}

/** 5 種類そろう。古い .doc / .xls は Word / Excel に数えられる */
export const Documents: Story = {
  name: "ドキュメント（種類で絞り込み）",
  decorators: [localeDecorator("ja")],
};

/** PDF と Word しか無いとき。Excel / PowerPoint のチップは出ない */
export const PdfAndWordOnly: Story = {
  name: "ドキュメント（PDF と Word だけ）",
  args: {
    mediaIndex: indexOf(LAB_DOCS.filter((m) => m.type === "pdf" || /\.docx?$/.test(m.name))),
  },
  decorators: [localeDecorator("ja")],
};

export const ManualEnglish: Story = {
  name: "Manual (English, bread world)",
  args: {
    mediaIndex: indexOf(BREAD_DOCS),
  },
  decorators: [localeDecorator("en")],
};

/**
 * 狭い幅のリスト表示。853px 幅のウィンドウからサイドバー（256px）を引いた 597px。
 * 右端の「日付」列が切れず、名前だけが省略記号で縮む（以前は表が 700px 未満に縮めず、
 * 日付列が枠の外へ出て横スクロールの手がかりも無かった）。
 */
export const NarrowList: Story = {
  name: "ドキュメント（狭い幅のリスト・597px）",
  decorators: [
    (Story) => (
      <div style={{ width: 597, height: 440, display: "flex", outline: "1px dashed var(--color-border)" }}>
        <Story />
      </div>
    ),
    localeDecorator("ja"),
  ],
};

/**
 * サイドピークが並んだ一覧の幅（853px 幅のウィンドウで約 277px）。見出しの項目
 * （戻る・種類・件数・右端のボタン）の合計が収まらないとき、右端のボタンは次の行へ落ちる
 * （以前は約 20px がピークの下に入って切れていた）。
 */
export const NarrowHeader: Story = {
  name: "ドキュメント（サイドピークと並んだ幅・277px・見出しが折り返す）",
  decorators: [
    (Story) => (
      <div style={{ width: 277, height: 440, display: "flex", outline: "1px dashed var(--color-border)" }}>
        <Story />
      </div>
    ),
    localeDecorator("ja"),
  ],
};

// ── データ素材（.csv / .txt）: 一覧で中身の線の形と列名・行数が見える ──
// 数値列がある素材は線、無い素材（文字だけの表）は表アイコンのまま列名と行数だけ、
// 読めない素材は「読み込めませんでした」。本文は primeAssetText で先に入れておく。

function dataEntry(fileId: string, name: string, days: number, usedIn: MediaUsage[] = []): MediaIndexEntry {
  return {
    fileId,
    name,
    type: "data",
    mimeType: "text/plain",
    url: "",
    thumbnailUrl: "",
    uploadedAt: daysAgo(days),
    usedIn,
  };
}

const BREAD_DATA: MediaIndexEntry[] = [
  dataEntry("proof-temp", "proofing-temperature.csv", 1, [use("n1", "Weekend sourdough bake")]),
  dataEntry("starter-rise", "starter-rise.csv", 2, [use("n2", "Starter feeding log")]),
  dataEntry("oven-preheat", "oven-preheat.txt", 4),
  dataEntry("flour-list", "flour-inventory.csv", 6),
  dataEntry("broken", "scale-export.dat", 9),
];

function seedBreadData() {
  clearAssetTextCache();
  clearDataPreviewCache();
  const hours = Array.from({ length: 48 }, (_, i) => i / 4);
  primeAssetText(
    "proof-temp",
    [
      "hour,dough_temp,room_temp",
      ...hours.map((h) => `${h},${(24 + 3 * (1 - Math.exp(-h / 3))).toFixed(2)},${(22 + Math.sin(h / 2)).toFixed(2)}`),
    ].join("\n"),
  );
  primeAssetText(
    "starter-rise",
    ["hour,height_mm", ...Array.from({ length: 13 }, (_, h) => `${h},${Math.round(40 + 60 / (1 + Math.exp(-(h - 6))))}`)].join("\n"),
  );
  primeAssetText(
    "oven-preheat",
    [
      "# Oven: deck oven A",
      "min\ttemp_c",
      ...Array.from({ length: 30 }, (_, m) => `${m}\t${Math.round(25 + 225 * (1 - Math.exp(-m / 8)))}`),
    ].join("\n"),
  );
  primeAssetText(
    "flour-list",
    ["flour,mill,protein", "bread flour,North Mill,high", "whole wheat,River Mill,medium", "rye,North Mill,low"].join("\n"),
  );
  // scale-export.dat は本文を入れない → プロバイダが無いので読めない
}

export const DataList: Story = {
  name: "Data (list, bread world)",
  args: { mediaIndex: indexOf(BREAD_DATA), mediaType: "data" },
  beforeEach: () => {
    seedBreadData();
  },
  decorators: [localeDecorator("en")],
};

// ── メモの印（カードと行）。1 件以上は常に出し、0 件は載せたときだけ薄く出す ──
// 表示形式（グリッド／リスト）の記憶を、このストーリーのためにそろえる
function setDocumentViewMode(mode: "gallery" | "list") {
  try {
    const key = "graphium:assetViewModeByType";
    const map = JSON.parse(localStorage.getItem(key) ?? "{}");
    localStorage.setItem(key, JSON.stringify({ ...map, document: mode, pdf: mode }));
  } catch {
    // 記憶できなくても、既定の表示で確かめられる
  }
}
const MEMO_AT = "2026-10-30T10:00:00.000Z";
const LAB_MEMOS: import("../mobile-capture").CaptureIndex = {
  version: 1,
  updatedAt: MEMO_AT,
  captures: [
    { id: "m1", text: "第 1 章の焼結温度の表をまとめる", createdAt: MEMO_AT, sourceAsset: { fileId: "pdf-1", type: "pdf" } },
    { id: "m2", text: "図 3 の粒径分布が気になる", createdAt: "2026-10-30T09:00:00.000Z", sourceAsset: { fileId: "pdf-1", type: "pdf" } },
    { id: "m3", text: "装置の校正日を確認\n\n— XRD装置マニュアル.pdf", createdAt: "2026-10-29T09:00:00.000Z" },
    { id: "m4", text: "条件の列が足りない", createdAt: "2026-10-28T09:00:00.000Z", sourceAsset: { fileId: "xlsx-1", type: "document" } },
  ],
};

/**
 * グリッド表示。「Cu粉末焼結_文献レビュー.pdf」は 2 件、「XRD装置マニュアル.pdf」は出典ラベルで 1 件、
 * 「焼結条件と密度.xlsx」は 1 件が常に出る。メモの無いカードは載せたときだけ薄い「＋付箋」が出る。
 * 印を押すと素材の小窓（見出し＝素材名・全画面で開く・書く欄・メモの一覧）。
 */
export const WithMemoChipsGrid: Story = {
  name: "メモの印（グリッド）",
  args: {
    captureIndex: LAB_MEMOS,
    onCreateMemoForAsset: async () => {},
    onOpenMemo: () => {},
  },
  decorators: [localeDecorator("ja")],
  beforeEach: () => setDocumentViewMode("gallery"),
};

/** リスト表示。名前の右に印が並ぶ。行の hover で 0 件の印が薄く出る */
export const WithMemoChipsList: Story = {
  name: "メモの印（リスト）",
  args: {
    captureIndex: LAB_MEMOS,
    onCreateMemoForAsset: async () => {},
    onOpenMemo: () => {},
  },
  decorators: [localeDecorator("ja")],
  beforeEach: () => setDocumentViewMode("list"),
};
