// デスクトップ受信箱（InboxView）のストーリー。
//
// ビューは InboxSource（listPending / readBlob）driven なので、Tauri / 実フォルダ
// なしで全状態を再現できる。ここでは特に **メモ / URL のネイティブ捕獲
// （.graphium.json）がメディアと混在する受信箱** を見る: 捕獲行はアイコン
// （📝 / 🔗）+ 中身プレビューで並び、行クリックのピークはテキスト表示になる。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { InboxView, type InboxSource } from "./InboxView";
import type { CaptureRef } from "./types";
import "../../../app.css";

const MEMO_NAME = "graphium-20260727-153000-01-memo.graphium.json";
const URL_NAME = "graphium-20260727-153000-02-url.graphium.json";

const ITEMS: CaptureRef[] = [
  { name: "graphium-20260727-142001-01.jpg", bytes: 2_130_000, modifiedAt: "2026-07-27T14:20:01Z" },
  { name: MEMO_NAME, bytes: 214, modifiedAt: "2026-07-27T15:30:00Z" },
  { name: URL_NAME, bytes: 186, modifiedAt: "2026-07-27T15:30:00Z" },
  { name: "graphium-20260727-141210-01.mov", bytes: 12_400_000, modifiedAt: "2026-07-27T14:12:10Z" },
];

const JSON_BY_NAME: Record<string, unknown> = {
  [MEMO_NAME]: {
    graphium: 1,
    kind: "memo",
    createdAt: "2026-07-27T15:30:00.000Z",
    text: "会議で出た仮説: 素材の粒度は「1 スクリーンで読み切れる」が上限\n細かすぎると逆に参照されない",
  },
  [URL_NAME]: {
    graphium: 1,
    kind: "url",
    createdAt: "2026-07-27T15:30:00.000Z",
    url: "https://example.com/papers/idea-capture",
    title: "The Science of Idea Capture",
    description: "How fleeting ideas survive the trip from phone to desk.",
  },
};

/** サムネイル用のダミー画像（canvas JPEG）。 */
async function makeJpeg(bg: string, fg: string): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = 160;
  c.height = 160;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 160, 160);
  g.fillStyle = fg;
  g.beginPath();
  g.arc(56, 52, 26, 0, 7);
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.65)";
  g.beginPath();
  g.moveTo(0, 122);
  g.lineTo(62, 78);
  g.lineTo(104, 108);
  g.lineTo(134, 90);
  g.lineTo(160, 110);
  g.lineTo(160, 160);
  g.lineTo(0, 160);
  g.closePath();
  g.fill();
  return await new Promise((resolve) => c.toBlob((b) => resolve(b!), "image/jpeg", 0.9));
}

const fakeSource: InboxSource = {
  listPending: async () => ITEMS,
  readBlob: async (ref) => {
    const json = JSON_BY_NAME[ref.name];
    if (json) {
      return new Blob([JSON.stringify(json)], {
        type: "application/vnd.graphium.capture+json",
      });
    }
    if (ref.name.endsWith(".jpg")) return makeJpeg("#8db4dd", "#2c4a6e");
    return new Blob([new Uint8Array(1024)], { type: "video/quicktime" });
  },
};

function InboxHost({ source }: { source: InboxSource | null }) {
  return (
    <div className="w-[960px] h-[560px] bg-background border border-border flex overflow-hidden">
      <InboxView
        rootConfigured={source != null}
        source={source}
        onPickRoot={() => {}}
        onImport={async () => {}}
        onBack={() => {}}
      />
    </div>
  );
}

const meta: Meta<typeof InboxHost> = {
  title: "Mobile Capture / InboxView",
  component: InboxHost,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "デスクトップ受信箱。同期フォルダ <root>/Inbox/ の未取り込みファイルを列挙し、" +
          "取り込みで素材ライブラリへ振り分ける。メモ / URL のネイティブ捕獲" +
          "（.graphium.json）はアイコン + 中身プレビューで並び、取り込みで本物の" +
          "メモ / URL 素材として着地する。",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof InboxHost>;

/** 写真 + メモ + URL + 動画が混在する受信箱。捕獲行はプレビュー付き。 */
export const MixedWithCaptures: Story = {
  args: { source: fakeSource },
};

/** 未接続（接続 CTA）。 */
export const NotConnected: Story = {
  args: { source: null },
};
