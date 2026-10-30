// 外のアプリで編集された素材の知らせ（デスクトップ版）のストーリー
//
// 上書きになる素材（どこからも引用されていない）と、新しい版になる素材
// （ノートから引用されている）を並べて、文言とボタンの違いを確かめる。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider, syncLocale, useT } from "../../i18n";
import { OpenedCopyNoticeView } from "./OpenedCopyNotice";
import type { MediaIndexEntry } from "./media-index";
import "../../app.css";

function entryOf(fileId: string, name: string): MediaIndexEntry {
  return {
    fileId,
    name,
    type: "document",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    url: `file-media://${fileId}`,
    thumbnailUrl: "",
    uploadedAt: "2026-10-30T00:00:00Z",
    usedIn: [],
  };
}

const ITEMS = [
  { entry: entryOf("m1", "proofing-schedule.xlsx"), fileName: "proofing-schedule.xlsx", mode: "replace" as const },
  { entry: entryOf("m2", "sourdough-method.docx"), fileName: "sourdough-method.docx", mode: "new-version" as const },
];

function Notice({ busy, withResult }: { busy?: string; withResult?: boolean }) {
  const t = useT();
  return (
    <OpenedCopyNoticeView
      items={ITEMS}
      busy={busy ?? null}
      result={withResult ? { kind: "new-version", name: "bake-plan.docx" } : null}
      onAdopt={() => {}}
      onDiscard={() => {}}
      onLater={() => {}}
      t={t}
    />
  );
}

const meta = {
  title: "AssetBrowser/OpenedCopyNotice",
  decorators: [
    (Story) => {
      syncLocale("en");
      return (
        <LocaleProvider>
          <div style={{ height: 420 }}>
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** 上書きになる素材と、新しい版になる素材 */
export const Default: Story = { render: () => <Notice /> };

/** 取り込み中（ボタンが止まる）と、終わったあとの知らせ */
export const Running: Story = { render: () => <Notice busy="m2" withResult /> };
