// SharedFoldersSection — 設定 → 共有 の共有フォルダ一覧（§26）。
// 部署ごとなど読める人が違う共有フォルダを複数登録し、1 件目を既定の共有先にする。
// ダイアログと接続テストは差し替えている（Storybook では Tauri が無い）。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { SharedFoldersSection } from "./SharedFoldersSection";
import { setSharedFolders, type SharedFolder } from "../../lib/storage/shared";

const FAKE: NonNullable<Parameters<typeof SharedFoldersSection>[0]["__test"]> = {
  pickFolder: async () => "/Volumes/Bakery/Team-Shop",
  testShared: async () => ({ ok: true, id: "demo", hash: "demo" }),
  testBlob: async () => ({ ok: true, id: "demo", hash: "demo" }),
};

const folder = (over: Partial<SharedFolder> & Pick<SharedFolder, "id" | "root">): SharedFolder => ({
  name: "",
  blobRoot: null,
  remote: null,
  ...over,
});

const meta: Meta<typeof SharedFoldersSection> = {
  title: "Molecules/SharedFoldersSection",
  component: SharedFoldersSection,
  args: { __test: FAKE },
  decorators: [
    (Story) => (
      <div className="max-w-2xl p-4">
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof SharedFoldersSection>;

/** まだ 1 件も無い（「フォルダを選択」だけ） */
export const Empty: Story = {
  beforeEach: () => setSharedFolders([]),
};

/** 1 件だけ（以前からの使い方）。既定の印は出さない — 選ぶものが無いので */
export const One: Story = {
  beforeEach: () =>
    setSharedFolders([folder({ id: "org", root: "/Volumes/Bakery/Shared", blobRoot: "/Volumes/Bakery/Shared-blobs" })]),
};

/** 組織全体と部署の 2 件。1 件目が既定の共有先 */
export const OrganizationAndTeam: Story = {
  name: "Organization and team (English, bread world)",
  beforeEach: () =>
    setSharedFolders([
      folder({
        id: "org",
        name: "Whole bakery",
        root: "/Volumes/Bakery/Shared",
        blobRoot: "/Volumes/Bakery/Shared-blobs",
      }),
      folder({ id: "team", name: "Sourdough team", root: "/Volumes/Bakery/Sourdough" }),
    ]),
};
