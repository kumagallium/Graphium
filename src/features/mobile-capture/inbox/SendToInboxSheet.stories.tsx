// 送信キューシートのストーリー。
//
// シートは props 駆動のプレゼンテーション層なので、キュー・認可の実物なしで
// 3 モード（接続済み / 未接続 / 未設定フォールバック）+ 失敗状態を再現できる。
// 端末サイズで見たいので mobile 相当の枠に入れる。

import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SendToInboxSheet, type SendToInboxSheetProps } from "./SendToInboxSheet";
import type { PushQueueItemMeta } from "./push";
import "../../../app.css";

function item(
  id: string,
  name: string,
  bytes: number,
  overrides: Partial<PushQueueItemMeta> = {},
): PushQueueItemMeta {
  return {
    id,
    name,
    mime: "image/jpeg",
    bytes,
    enqueuedAt: "2026-07-27T10:20:30.000Z",
    status: "pending",
    attempts: 0,
    ...overrides,
  };
}

const baseItems: PushQueueItemMeta[] = [
  item("a", "graphium-20260727-102030-01.jpg", 412_300),
  item("b", "graphium-20260727-102030-02.mov", 12_400_000, { mime: "video/quicktime" }),
  item("c", "graphium-20260727-102030-03.m4a", 96_000, { mime: "audio/mp4" }),
];

const noop = () => {};

const baseProps: SendToInboxSheetProps = {
  items: baseItems,
  draining: false,
  activeId: null,
  progress: {},
  configured: true,
  connected: true,
  connecting: false,
  connectError: null,
  canWebShare: false,
  webShareError: null,
  onAddFiles: noop,
  onSend: noop,
  onConnect: noop,
  onRemoveItem: noop,
  onRetryFailed: noop,
  onWebShare: noop,
  onOpenSettings: noop,
  onClose: noop,
};

/** シートは開いた状態で見たいので、閉じたら再度開けるようにしておく。 */
function SheetHost(props: SendToInboxSheetProps) {
  const [open, setOpen] = useState(true);
  return (
    <div className="w-[390px] h-[720px] relative bg-background border border-border overflow-hidden">
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="absolute inset-x-4 top-4 py-3 rounded-xl bg-primary text-primary-foreground text-sm"
        >
          reopen
        </button>
      )}
      {open && <SendToInboxSheet {...props} onClose={() => setOpen(false)} />}
    </div>
  );
}

const meta: Meta<typeof SheetHost> = {
  title: "Mobile Capture / SendToInboxSheet",
  component: SheetHost,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "モバイルの送信キューシート。撮ったファイルはまず端末内のキュー（IndexedDB）に永続化され、" +
          "Google Drive の Graphium/Inbox へ直列アップロードされる。Google 未設定の環境では " +
          "OS の共有シートで同期フォルダに置くフォールバックを出す。",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof SheetHost>;

/** 接続済み + キューあり。自動送信が走る前提で、手動の「送信」も出る。 */
export const ConnectedWithQueue: Story = {
  args: { ...baseProps },
};

/** 接続済みで 2 件目を送信中（進捗バー + パーセント表示）。 */
export const Uploading: Story = {
  args: {
    ...baseProps,
    draining: true,
    activeId: "b",
    progress: { b: { sentBytes: 7_800_000, totalBytes: 12_400_000 } },
  },
};

/** 未接続（client ID は設定済み）。接続ボタンから GIS ポップアップへ。 */
export const Disconnected: Story = {
  args: { ...baseProps, connected: false },
};

/** 接続失敗（ポップアップを閉じた・権限拒否など）。 */
export const ConnectFailed: Story = {
  args: {
    ...baseProps,
    connected: false,
    connectError: "Popup closed by user",
  },
};

/** 未設定（client ID なし）+ Web Share フォールバック。設定への導線も出す。 */
export const NotConfiguredFallback: Story = {
  args: {
    ...baseProps,
    configured: false,
    connected: false,
    canWebShare: true,
  },
};

/** 未設定で Web Share も使えない環境（この状態では撮影はローカル保存に落ちるので、
    シートに来るのは前回の送り残しがあるときだけ）。 */
export const NotConfiguredNoShare: Story = {
  args: {
    ...baseProps,
    configured: false,
    connected: false,
    canWebShare: false,
    items: [baseItems[0]],
  },
};

/** リトライ上限に達した failed アイテムがある状態。再試行導線が出る。 */
export const WithFailedItems: Story = {
  args: {
    ...baseProps,
    items: [
      baseItems[0],
      item("d", "graphium-20260727-095912-01.jpg", 2_100_000, {
        status: "failed",
        attempts: 5,
        lastError: "Drive multipart upload failed (500)",
      }),
    ],
  },
};

/** キューが空の状態。 */
export const Empty: Story = {
  args: { ...baseProps, items: [] },
};
