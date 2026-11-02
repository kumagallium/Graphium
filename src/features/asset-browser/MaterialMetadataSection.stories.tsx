// 素材詳細（全画面の右パネル）のメタデータ欄。出どころ情報（著者・年・発行元・DOI）の見え方を確かめる

import type { Meta, StoryObj } from "@storybook/react-vite";
import { MaterialMetadataSection } from "./material-metadata-section";
import type { MediaIndexEntry } from "./media-index";
import "../../app.css";

const PDF: MediaIndexEntry = {
  fileId: "pdf-1",
  name: "Theory of Sintering by Kingery (1958).pdf",
  type: "pdf",
  mimeType: "application/pdf",
  url: "",
  thumbnailUrl: "",
  uploadedAt: "2026-10-20T06:46:00.000Z",
  usedIn: [{ noteId: "note-6", noteTitle: "文献レビュー: Cu焼結の最適条件", blockId: "b3" }],
  pageCount: 12,
};

const meta: Meta<typeof MaterialMetadataSection> = {
  title: "AssetBrowser/MaterialMetadataSection",
  component: MaterialMetadataSection,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div style={{ width: 380, border: "1px solid var(--color-border)", padding: 12 }}>
        <Story />
      </div>
    ),
  ],
  args: { variant: "plain" },
};
export default meta;
type Story = StoryObj<typeof MaterialMetadataSection>;

/** Crossref で補完した後 */
export const WithSourceInfo: Story = {
  args: {
    entry: {
      ...PDF,
      sourceInfo: {
        authors: ["W. David Kingery", "Morris Berg"],
        year: 1955,
        venue: "Journal of Applied Physics",
        doi: "10.1063/1.1721830",
        origin: "crossref",
      },
    },
  },
};

/** 取り込み時にファイルから DOI だけ読めた状態 */
export const DoiOnly: Story = {
  args: { entry: { ...PDF, sourceInfo: { doi: "10.1063/1.1721830", origin: "file" } } },
};

/** 何も無い（未設定の表示） */
export const Empty: Story = {
  args: { entry: PDF },
};

/** マニュアルの図（英語 UI・パン作りの世界観）。scripts/manual-screenshots-storybook-extra.mjs で撮る */
export const ManualEnglish: Story = {
  name: "Manual (English, bread world)",
  args: {
    entry: {
      ...PDF,
      name: "Hydration and crumb structure in sourdough.pdf",
      usedIn: [{ noteId: "note-1", noteTitle: "Reading notes: hydration and crumb", blockId: "b1" }],
      sourceInfo: {
        authors: ["Eleanor Whitfield", "Tomas Brandt"],
        year: 2021,
        venue: "Journal of Cereal Science",
        doi: "10.1000/example.2021.0042",
        origin: "crossref",
      },
    },
  },
};
