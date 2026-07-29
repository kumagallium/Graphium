// ホームの捕獲履歴セクションのストーリー。
//
// セクションは props 駆動のプレゼンテーション層なので、キュー・認可の実物なしで
// 全状態（混在 / 送信中 / 失敗あり / 送信済みのみ / 未接続 / 未設定 / 空）を
// 再現できる。ホームでの見え方に合わせ、モバイル幅の枠に検索欄 → 統合リスト →
// 画面下固定の捕獲バー（MobileCaptureBar 実物）を敷いて、
// 「履歴は上・捕獲は下バー・送信は見出し行右端」の並びを見る。
// サムネイルは loadThumbnail のフェイク（色違い SVG Blob）で object URL 経路ごと再現する。

import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  CaptureHistorySection,
  type CaptureHistorySectionProps,
} from "./CaptureHistorySection";
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

/** 送信済みの履歴（撮った手応えとして残り続ける行）。 */
const sentItems: PushQueueItemMeta[] = [
  item("s1", "graphium-20260727-091500-01.jpg", 2_240_000, {
    status: "sent",
    enqueuedAt: "2026-07-27T09:15:00.000Z",
    sentAt: "2026-07-27T09:15:20.000Z",
  }),
  item("s2", "graphium-20260727-084000-01-memo.graphium.json", 210, {
    mime: "application/vnd.graphium.capture+json",
    status: "sent",
    preview: "研究会で出た指摘: 粒度は「1 スクリーンで読み切れる」が上限",
    enqueuedAt: "2026-07-27T08:40:00.000Z",
    sentAt: "2026-07-27T08:40:10.000Z",
  }),
  item("s3", "graphium-20260726-201200-01-url.graphium.json", 260, {
    mime: "application/vnd.graphium.capture+json",
    status: "sent",
    preview: "The Science of Idea Capture",
    previewUrl: "https://example.com/papers/idea-capture",
    enqueuedAt: "2026-07-26T20:12:00.000Z",
    sentAt: "2026-07-26T20:12:08.000Z",
  }),
];

/** この端末に残る過去のローカル項目（送信対象ではないので状態バッジなし）。 */
const localItems: CaptureHistorySectionProps["localItems"] = [
  {
    id: "l1",
    kind: "memo",
    title: "先週のメモ: グラフの色は hue でなく彩度で分ける",
    timestamp: "2026-07-25T11:05:00.000Z",
  },
  {
    id: "l2",
    kind: "image",
    title: "whiteboard.jpg",
    timestamp: "2026-07-24T15:30:00.000Z",
  },
  {
    id: "l3",
    kind: "url",
    title: "PROV-DM Primer",
    detail: "w3.org",
    timestamp: "2026-07-23T09:00:00.000Z",
  },
];

/** 画像サムネイル用のフェイク Blob（id ごとに色の違う SVG）。 */
const fakeLoadThumbnail = (id: string): Promise<Blob | null> => {
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

const baseProps: CaptureHistorySectionProps = {
  items: baseItems,
  localItems: [],
  draining: false,
  activeId: null,
  progress: {},
  configured: true,
  connected: true,
  connecting: false,
  connectError: null,
  onSend: noop,
  onOpenStoragePicker: noop,
  onRemoveItem: noop,
  onRetryFailed: noop,
  onOpenSettings: noop,
  onOpenLocalItem: noop,
  loadThumbnail: fakeLoadThumbnail,
};

/** モバイルホーム相当の枠。検索欄 → 統合リスト → 下固定の捕獲バーの並びを見る。 */
function SectionHost(props: CaptureHistorySectionProps) {
  return (
    <div className="w-[390px] h-[720px] bg-background border border-border flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3">
        <div className="h-8 rounded-lg border border-border bg-background flex items-center px-2.5 text-xs text-muted-foreground">
          Search memos
        </div>
        <CaptureHistorySection {...props} />
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
  title: "Mobile Capture / CaptureHistorySection",
  component: SectionHost,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "モバイルホームの捕獲履歴。撮ったものは送信状態にかかわらず 1 本の時系列に" +
          "新しい順で並び続ける（送信済みも消えない）。行の状態は 待機 / 送信中 % / " +
          "送信済み ✓ / 失敗 で、送信済みは控えめ・要対応が目立つ塗り分け。" +
          "この端末に残る過去のメモ・素材は破線枠・バッジなしで同じリストに混ざる。" +
          "[送信 (n)] は見出し行右端の定位置で、未送信があるときだけ出る。" +
          "捕獲の入口は画面下固定の捕獲バー（書く/URL/写真/動画/音声/ライブラリ）。",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof SectionHost>;

/** 混在（既定）: 待機 / 送信済み / 失敗 / 過去のローカル項目が時系列で並ぶ。 */
export const Mixed: Story = {
  args: {
    ...baseProps,
    items: [
      baseItems[0],
      item("f", "graphium-20260727-095912-01.jpg", 2_100_000, {
        status: "failed",
        attempts: 5,
        lastError: "Drive multipart upload failed (500)",
        enqueuedAt: "2026-07-27T09:59:12.000Z",
      }),
      ...sentItems,
    ],
    localItems,
  },
};

/** 接続済み + 未送信だけ。[送信 (3)] が見出し行の右端に出る。 */
export const UnsentOnly: Story = {
  args: { ...baseProps },
};

/** 2 件目を送信中（進捗バー + 見出しの送信ボタンは「送信中...」で無効）。 */
export const Uploading: Story = {
  args: {
    ...baseProps,
    draining: true,
    activeId: "b",
    progress: { b: { sentBytes: 7_800_000, totalBytes: 12_400_000 } },
    items: [...baseItems, ...sentItems],
    localItems,
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
      ...sentItems,
    ],
  },
};

/** 送信済みだけ（送り終えた後のホーム）。接続導線も送信ボタンも出さない。 */
export const SentOnly: Story = {
  args: { ...baseProps, items: sentItems, localItems },
};

/** 未接続（client ID は設定済み）。未送信があるので [ストレージに接続] が出る。 */
export const Disconnected: Story = {
  args: { ...baseProps, connected: false, items: [...baseItems, ...sentItems] },
};

/** 接続失敗（ポップアップを閉じた・権限拒否など）。 */
export const ConnectFailed: Story = {
  args: {
    ...baseProps,
    connected: false,
    connectError: "Popup closed by user",
  },
};

/** 未設定（client ID なし）。案内 + 設定導線（詳細設定の client_id 上書き）のみ。 */
export const NotConfigured: Story = {
  args: {
    ...baseProps,
    configured: false,
    connected: false,
    items: [baseItems[0]],
  },
};

/** 履歴もローカル項目も無い（セクションごと畳まれた状態）。捕獲バーだけが残る。 */
export const Empty: Story = {
  args: { ...baseProps, items: [], localItems: [] },
};
