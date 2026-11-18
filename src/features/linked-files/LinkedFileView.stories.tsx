// LinkedFileView — リンクした素材 1 件の中身の表示（素材ピーク・全画面）。
// 状態は 5 通り: 変わりなし／変わっています／見つかりません／置き場に届きません／この端末に未登録。
// 置き場の操作は Tauri に依存するので、いまの状態（statLinks）は差し替えている。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { LinkedFileView } from "./LinkedFileView";
import { buildPlaceUrl } from "./link-url";
import type { LinkStat } from "./places";
import type { MediaIndexEntry } from "../asset-browser/media-index";
import "../../app.css";

const MTIME = Date.UTC(2026, 10, 9, 12, 0, 0);
const REL = "Recipes/Dough hydration.xlsx";

const ENTRY: MediaIndexEntry = {
  fileId: "url_demo",
  name: "Dough hydration.xlsx",
  type: "url",
  mimeType: "text/x-uri",
  url: buildPlaceUrl("org", REL),
  thumbnailUrl: "",
  uploadedAt: "2026-11-10T09:00:00.000Z",
  usedIn: [],
  urlMeta: { domain: "Whole bakery", description: REL },
  link: { placeId: "org", relPath: REL, size: 48_213, mtimeMs: MTIME, recordedAt: "2026-11-10T09:00:00.000Z" },
};

const fake = (stat: LinkStat): NonNullable<Parameters<typeof LinkedFileView>[0]["__test"]> => ({
  statLinks: async (items) => items.map(() => stat),
  listPlaces: async () => [{ id: "org", name: "Whole bakery", root: "/Volumes/Bakery/Shared", reachable: true, shared: true }],
  openLinkedFile: async () => {},
  revealLinkedFile: async () => {},
  persistLinkPatch: async () => true,
});

const meta: Meta<typeof LinkedFileView> = {
  title: "AssetBrowser/LinkedFileView",
  component: LinkedFileView,
  args: { entry: ENTRY },
  decorators: [
    (Story) => (
      <div className="p-6 bg-background">
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof LinkedFileView>;

/** 変わりなし: 控えたときと大きさ・更新日時が同じ */
export const Unchanged: Story = { args: { __test: fake({ state: "ok", size: 48_213, mtimeMs: MTIME }) } };

/** 変わっています: 控えといまを並べて見せ、「いまの状態を控え直す」を出す */
export const Changed: Story = {
  args: { __test: fake({ state: "ok", size: 51_904, mtimeMs: MTIME + 3 * 86_400_000 }) },
};

/** 元のファイルが見つかりません（置き場には届いている）。開く・場所を表示は押せない */
export const Missing: Story = { args: { __test: fake({ state: "missing" }) } };

/** 置き場に届きません（ドライブや同期が切れている）。開く・場所を表示は押せない */
export const Unreachable: Story = { args: { __test: fake({ state: "unreachable" }) } };

/** この置き場は、この端末に登録されていません。開く・場所を表示は押せない */
export const Unregistered: Story = { args: { __test: fake({ state: "unregistered" }) } };

/** 控え直しの履歴あり（折りたたみ。新しい順） */
export const WithHistory: Story = {
  args: {
    entry: {
      ...ENTRY,
      link: {
        ...ENTRY.link!,
        history: [
          { size: 45_880, mtimeMs: MTIME - 5 * 86_400_000, recordedAt: "2026-11-05T09:00:00.000Z" },
          { size: 41_002, mtimeMs: MTIME - 12 * 86_400_000, recordedAt: "2026-10-28T09:00:00.000Z" },
        ],
      },
    },
    __test: fake({ state: "ok", size: 48_213, mtimeMs: MTIME }),
  },
};
