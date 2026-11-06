// SharedFoldersSection — 設定 → 共有 の共有フォルダ一覧（§26・1 行 1 フォルダ。利用者の選択「A」2026-11-06）。
// 行: 状態の印・名前・既定の印・場所・中身の件数・⋯。行を押すと場所・画像や PDF の置き場・接続の確認が開く。
// ダイアログ・接続テスト・見えているかの確認は差し替えている（Storybook では Tauri が無い）。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { SharedFoldersSection } from "./SharedFoldersSection";
import { setSharedFolders, type SharedEntry, type SharedFolder } from "../../lib/storage/shared";

const ORG = "/Volumes/Bakery/Shared";
const TEAM = "/Volumes/Bakery/Sourdough";

const e = (id: string, type: SharedEntry["type"]) => ({ id, type }) as SharedEntry;
const ENTRIES = {
  entries: [
    e("n1", "note"), e("n2", "note"), e("n3", "note"), e("t1", "template"), e("t2", "template"),
    e("k1", "knowledge"), e("n4", "note"), e("n5", "note"), e("a1", "reference"),
  ],
  entryRoots: { n1: ORG, n2: ORG, n3: ORG, t1: ORG, t2: ORG, k1: TEAM, n4: TEAM, n5: TEAM, a1: TEAM },
};

const FAKE: NonNullable<Parameters<typeof SharedFoldersSection>[0]["__test"]> = {
  pickFolder: async () => "/Volumes/Bakery/Front-of-house",
  testShared: async () => ({ ok: true, id: "demo", hash: "demo" }),
  testBlob: async () => ({ ok: true, id: "demo", hash: "demo" }),
  checkReachable: async () => true,
  entries: ENTRIES,
};

const folder = (over: Partial<SharedFolder> & Pick<SharedFolder, "id" | "root">): SharedFolder => ({
  name: "",
  blobRoot: null,
  remote: null,
  ...over,
});

const TWO = () =>
  setSharedFolders([
    folder({ id: "org", name: "Whole bakery", root: ORG, blobRoot: "/Volumes/Bakery/Shared-blobs" }),
    folder({ id: "team", name: "Sourdough team", root: TEAM }),
  ]);

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

/** まだ 1 件も無い（案内と「フォルダを選択」） */
export const Empty: Story = {
  beforeEach: () => setSharedFolders([]),
};

/** 1 件だけ（以前からの使い方）。既定の印は出さない — 選ぶものが無いので */
export const One: Story = {
  beforeEach: () => setSharedFolders([folder({ id: "org", root: ORG, blobRoot: "/Volumes/Bakery/Shared-blobs" })]),
};

/** 組織全体と部署の 2 件。1 件目が既定の共有先 */
export const OrganizationAndTeam: Story = {
  name: "Organization and team (English, bread world)",
  beforeEach: TWO,
};

/** 2 件目が届かない（NAS のマウント外れ）。行の印が変わり、開くと案内が出る */
export const OneUnreachable: Story = {
  beforeEach: TWO,
  args: { __test: { ...FAKE, checkReachable: async (root: string) => root !== TEAM } },
};
