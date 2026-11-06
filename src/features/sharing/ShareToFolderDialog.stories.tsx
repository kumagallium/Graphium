// ShareToFolderDialog — 共有フォルダが 2 件以上あるとき、初めての「チームと共有」で出る小さなダイアログ（§26 PR3）。
// 初期値は既定の共有先。誰が読めるかはフォルダの権限で決まるので、名前と実パスを並べる。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { ShareToFolderDialog } from "./ShareToFolderDialog";
import { setSharedFolders, type SharedFolder } from "../../lib/storage/shared";

const folder = (over: Partial<SharedFolder> & Pick<SharedFolder, "id" | "root">): SharedFolder => ({
  name: "",
  blobRoot: null,
  remote: null,
  ...over,
});

const meta: Meta<typeof ShareToFolderDialog> = {
  title: "Molecules/ShareToFolderDialog",
  component: ShareToFolderDialog,
  args: { open: true, itemTitle: "Sourdough starter log — day 3", onConfirm: () => {}, onClose: () => {} },
  beforeEach: () =>
    setSharedFolders([
      folder({ id: "org", name: "Whole bakery", root: "/Volumes/Bakery/Shared", blobRoot: "/Volumes/Bakery/Shared-blobs" }),
      folder({ id: "team", name: "Sourdough team", root: "/Volumes/Bakery/Sourdough" }),
    ]),
};
export default meta;

type Story = StoryObj<typeof ShareToFolderDialog>;

/** Manual (English, bread world) — 共有先を選ぶダイアログ */
export const ManualEnglish: Story = { name: "Manual (English, bread world)" };

/** 共有中（ボタンが止まる） */
export const Busy: Story = { args: { busy: true } };
