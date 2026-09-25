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
  extra: { usedIn?: MediaUsage[]; noteContexts?: string[] } = {},
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
const BREAD_DOCS: MediaIndexEntry[] = [
  docEntry("pdf-1", "proofing-guide.pdf", MIME.pdf, 1, {
    usedIn: [use("n1", "Weekend sourdough bake"), use("n2", "Starter feeding log")],
    noteContexts: ["Sourdough"],
  }),
  docEntry("pdf-2", "bread-science.pdf", MIME.pdf, 6, { usedIn: [use("n1", "Weekend sourdough bake")] }),
  docEntry("docx-1", "shaping-notes.docx", MIME.docx, 2, { noteContexts: ["Baguette"] }),
  docEntry("xlsx-1", "hydration-log.xlsx", MIME.xlsx, 3, {
    usedIn: [use("n2", "Starter feeding log")],
    noteContexts: ["Sourdough/Starter"],
  }),
  docEntry("xlsx-2", "oven-readings.xlsx", MIME.xlsx, 9, { noteContexts: ["Shared/Equipment"] }),
  docEntry("pptx-1", "baking-workshop.pptx", MIME.pptx, 4),
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
