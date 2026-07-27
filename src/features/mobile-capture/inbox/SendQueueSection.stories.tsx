// ホームの送信キューセクションのストーリー。
//
// セクションは props 駆動のプレゼンテーション層なので、キュー・認可の実物なしで
// 全状態（接続済み+キュー / 送信中 / 失敗 / 未接続 / 未設定フォールバック / 空）を
// 再現できる。ホームでの見え方に合わせ、モバイル幅の枠にキュー（最上部）→
// タイムラインのプレースホルダ → 画面下固定の捕獲バー（MobileCaptureBar 実物）を
// 敷いて「キューは上・捕獲は下バー・送信は見出し行右端」の並びを見る。
// サムネイルは loadItemBlob のフェイク（色違い SVG Blob）で object URL 経路ごと再現する。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { SendQueueSection, type SendQueueSectionProps } from "./SendQueueSection";
import { MobileCaptureBar } from "../MobileCaptureBar";
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

/** 画像サムネイル用のフェイク Blob（id ごとに色の違う SVG）。 */
const fakeLoadItemBlob = (id: string): Promise<Blob | null> => {
  const hue = (id.charCodeAt(0) * 47) % 360;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80">` +
    `<rect width="80" height="80" fill="hsl(${hue}, 55%, 72%)"/>` +
    `<circle cx="26" cy="30" r="9" fill="hsl(${hue}, 45%, 88%)"/>` +
    `<path d="M0 62 L28 40 L46 54 L62 44 L80 58 L80 80 L0 80 Z" fill="hsl(${hue}, 40%, 55%)"/>` +
    `</svg>`;
  return Promise.resolve(new Blob([svg], { type: "image/svg+xml" }));
};

const noop = () => {};

const baseProps: SendQueueSectionProps = {
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
  onSend: noop,
  onOpenStoragePicker: noop,
  onRemoveItem: noop,
  onRetryFailed: noop,
  onWebShare: noop,
  onOpenSettings: noop,
  loadItemBlob: fakeLoadItemBlob,
};

/** モバイルホーム相当の枠。キュー（上）→ タイムライン → 下固定の捕獲バーの並びを見る。 */
function SectionHost(props: SendQueueSectionProps) {
  return (
    <div className="w-[390px] h-[720px] bg-background border border-border flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3">
        <SendQueueSection {...props} />
        <div className="grid grid-cols-2 gap-2.5 opacity-50">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-card border border-border rounded-lg p-3">
              <div className="h-2 w-3/4 rounded bg-muted mb-2" />
              <div className="h-2 w-1/2 rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
      <MobileCaptureBar
        onComposeMemo={noop}
        onAddUrl={noop}
        showMediaButtons
        onAddFiles={noop}
      />
    </div>
  );
}

const meta: Meta<typeof SectionHost> = {
  title: "Mobile Capture / SendQueueSection",
  component: SectionHost,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "モバイルホームの送信キューセクション。未送信キューがコンテンツ最上部に常時インラインで" +
          "見え（かつてのボトムシートの置き換え）、[送信 (n)] は見出し行右端の定位置に出る。" +
          "捕獲の入口は画面下固定の捕獲バー（MobileCaptureBar: 書く/URL/写真/動画/音声/ライブラリ）。" +
          "ファイルは端末内キュー（IndexedDB）に永続化され、Google Drive の Graphium/Inbox へ" +
          "直列アップロードされる。未設定環境では OS の共有シートで同期フォルダに置く" +
          "フォールバックを出す。キューが空のときはセクションごと畳まれ、捕獲バーだけが残る。",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof SectionHost>;

/** 接続済み + キューあり。[送信 (3)] が見出し行の右端に出る。 */
export const ConnectedWithQueue: Story = {
  args: { ...baseProps },
};

// ── メモ / URL 捕獲（ネイティブ JSON）が混在するキュー ──
// キューには写真とメモ（📝 + 本文先頭）・URL（🔗 + タイトル + ドメイン）が同列に並ぶ。
// プレビューは loadItemBlob が返す JSON をその場でパースして出す（実機と同じ経路）。

const captureJsonBlobs: Record<string, unknown> = {
  m: {
    graphium: 1,
    kind: "memo",
    createdAt: "2026-07-27T10:21:00.000Z",
    text: "会議で出た仮説: 素材の粒度は「1 スクリーンで読み切れる」が上限\n細かすぎると逆に参照されない",
  },
  u: {
    graphium: 1,
    kind: "url",
    createdAt: "2026-07-27T10:22:00.000Z",
    url: "https://example.com/papers/idea-capture",
    title: "The Science of Idea Capture",
  },
};

const mixedLoadItemBlob = (id: string): Promise<Blob | null> => {
  const json = captureJsonBlobs[id];
  if (json) {
    return Promise.resolve(
      new Blob([JSON.stringify(json)], { type: "application/vnd.graphium.capture+json" }),
    );
  }
  return fakeLoadItemBlob(id);
};

/** 写真 + メモ + URL が混在するキュー。 */
export const MixedWithMemoAndUrl: Story = {
  args: {
    ...baseProps,
    items: [
      item("a", "graphium-20260727-102030-01.jpg", 412_300),
      item("m", "graphium-20260727-102100-01-memo.graphium.json", 180, {
        mime: "application/vnd.graphium.capture+json",
      }),
      item("u", "graphium-20260727-102200-01-url.graphium.json", 240, {
        mime: "application/vnd.graphium.capture+json",
      }),
    ],
    loadItemBlob: mixedLoadItemBlob,
  },
};

/** 接続済みで 2 件目を送信中（進捗バー + 見出しの送信ボタンは「送信中...」で無効）。 */
export const Uploading: Story = {
  args: {
    ...baseProps,
    draining: true,
    activeId: "b",
    progress: { b: { sentBytes: 7_800_000, totalBytes: 12_400_000 } },
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

/** 未接続（client ID は設定済み）。主アクションは [ストレージに接続] —
    タップでストレージ選択（StoragePickerSheet）が開く。 */
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

/** 未設定で Web Share も使えない環境（撮影はローカル保存に落ちるので、
    キューに残るのは前回の送り残しだけ）。設定導線のみ。 */
export const NotConfiguredNoShare: Story = {
  args: {
    ...baseProps,
    configured: false,
    connected: false,
    canWebShare: false,
    items: [baseItems[0]],
  },
};

/** キューが空（セクションごと畳まれた状態）。捕獲バーとタイムラインだけが残る。 */
export const Empty: Story = {
  args: { ...baseProps, items: [] },
};
