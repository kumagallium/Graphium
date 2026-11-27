// 右パネルの受信箱（MobileInboxPanel）のストーリー。
//
// 場面は「実験室で撮った写真が、開いているノートの横に届く」。タイルを押すと
// ノートに入り、受信箱からは消える（ここでは 0.8 秒後に一覧から外して再現する）。
// 幅は右パネルの下限 320px と上限 480px の両方で見る。

import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { INBOX_DRAG_MIME, MobileInboxPanel } from "./MobileInboxPanel";
import type { InboxSource } from "./InboxView";
import type { CaptureRef } from "./types";
import "../../../app.css";

const MEMO_NAME = "graphium-20260727-153000-01-memo.graphium.json";
const URL_NAME = "graphium-20260727-153200-02-url.graphium.json";

const PHOTOS: CaptureRef[] = [
  { name: "graphium-20260727-142001-01.jpg", bytes: 2_130_000, modifiedAt: "2026-07-27T14:20:01" },
  { name: "graphium-20260727-142210-01.jpg", bytes: 1_980_000, modifiedAt: "2026-07-27T14:22:10" },
  { name: "graphium-20260727-142455-01.jpg", bytes: 2_410_000, modifiedAt: "2026-07-27T14:24:55" },
  { name: "graphium-20260727-150130-01.jpg", bytes: 2_050_000, modifiedAt: "2026-07-27T15:01:30" },
  { name: "graphium-20260727-150702-01.jpg", bytes: 1_870_000, modifiedAt: "2026-07-27T15:07:02" },
];

const MIXED: CaptureRef[] = [
  ...PHOTOS.slice(0, 3),
  { name: MEMO_NAME, bytes: 214, modifiedAt: "2026-07-27T15:30:00" },
  { name: URL_NAME, bytes: 186, modifiedAt: "2026-07-27T15:32:00" },
  { name: "graphium-20260727-151210-01.mov", bytes: 12_400_000, modifiedAt: "2026-07-27T15:12:10" },
  { name: "graphium-20260727-152000-01.m4a", bytes: 840_000, modifiedAt: "2026-07-27T15:20:00" },
];

const JSON_BY_NAME: Record<string, unknown> = {
  [MEMO_NAME]: {
    graphium: 1,
    kind: "memo",
    createdAt: "2026-07-27T15:30:00.000Z",
    text: "二次発酵は 35 分で止めた。生地の表面が少し乾いていた",
  },
  [URL_NAME]: {
    graphium: 1,
    kind: "url",
    createdAt: "2026-07-27T15:32:00.000Z",
    url: "https://example.com/baking/hydration",
    title: "Hydration and crumb structure",
  },
};

const PALETTE: [string, string][] = [
  ["#d9c7a3", "#8a6a3b"],
  ["#c9d6c3", "#56704d"],
  ["#e3cdbd", "#9a5b3c"],
  ["#c8d3e0", "#4a6485"],
  ["#e0d4c0", "#7a6a4a"],
];

/** サムネイル用のダミー画像（canvas JPEG）。名前ごとに色を変える。 */
async function makeJpeg(index: number): Promise<Blob> {
  const [bg, fg] = PALETTE[index % PALETTE.length];
  const c = document.createElement("canvas");
  c.width = 240;
  c.height = 240;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 240, 240);
  g.fillStyle = fg;
  g.beginPath();
  g.ellipse(120, 132, 78 - index * 4, 52 + index * 3, 0, 0, 7);
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.5)";
  g.fillRect(0, 196, 240, 44);
  return await new Promise((resolve) => c.toBlob((b) => resolve(b!), "image/jpeg", 0.9));
}

// マニュアルの図用（英語）。メモと URL の中身だけ英語にする
const JSON_BY_NAME_EN: Record<string, unknown> = {
  ...JSON_BY_NAME,
  [MEMO_NAME]: {
    graphium: 1,
    kind: "memo",
    createdAt: "2026-07-27T15:30:00.000Z",
    text: "Stopped the final proof at 35 minutes. The surface had dried a little",
  },
};

const makeSource = (jsonByName: Record<string, unknown>): InboxSource => ({
  listPending: async () => MIXED,
  readBlob: async (ref) => {
    const json = jsonByName[ref.name];
    if (json) {
      return new Blob([JSON.stringify(json)], { type: "application/vnd.graphium.capture+json" });
    }
    if (ref.name.endsWith(".jpg")) {
      return makeJpeg(Math.max(0, PHOTOS.findIndex((p) => p.name === ref.name)));
    }
    return new Blob([new Uint8Array(1024)]);
  },
});
const fakeSource = makeSource(JSON_BY_NAME);
const fakeSourceEn = makeSource(JSON_BY_NAME_EN);

const INITIAL_BLOCKS_EN: NoteBlock[] = [
  { id: "h", text: "Country loaf, trial 3", heading: true },
  { id: "p1", text: "Raised hydration to 75%. Bulk fermentation at 27 °C for 3 hours." },
  { id: "p2", text: "The dough after shaping:", caret: true },
  { id: "p3", text: "Final proof 35 minutes. One score." },
  { id: "p4", text: "The crumb after baking:" },
];

type NoteBlock = {
  id: string;
  text: string;
  heading?: boolean;
  /** モックのカーソルがこのブロックの末尾にある。 */
  caret?: boolean;
  /** 受信箱から入ったブロック。 */
  inserted?: boolean;
};

const INITIAL_BLOCKS: NoteBlock[] = [
  { id: "h", text: "カンパーニュ 試作 3 回目", heading: true },
  { id: "p1", text: "加水率を 75% に上げた。一次発酵は 27℃ で 3 時間。" },
  { id: "p2", text: "成形後の生地の状態:", caret: true },
  { id: "p3", text: "二次発酵は 35 分。クープは 1 本。" },
  { id: "p4", text: "焼き上がりの断面:" },
];

function PanelHost({
  initialItems,
  connected = true,
  width = 360,
  initialBusy = [],
  english = false,
}: {
  /** マニュアルの図用: ノートのモックとメモの中身を英語にする。 */
  english?: boolean;
  initialItems: CaptureRef[];
  connected?: boolean;
  /** 右パネルの幅（既定 clamp(320px, 30vw, 480px)）。 */
  width?: number;
  initialBusy?: string[];
}) {
  const [items, setItems] = useState(initialItems);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set(initialBusy));
  const [blocks, setBlocks] = useState<NoteBlock[]>(english ? INITIAL_BLOCKS_EN : INITIAL_BLOCKS);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  // 取り込み（0.8 秒）→ 受信箱から消える → ノートの index の位置に入る
  const insertAt = (names: string[], index: number) => {
    setBusy(new Set(names));
    setTimeout(() => {
      setItems((prev) => prev.filter((r) => !names.includes(r.name)));
      setBusy(new Set());
      setBlocks((prev) => [
        ...prev.slice(0, index),
        ...names.map((name) => ({ id: `in-${name}`, text: name, inserted: true })),
        ...prev.slice(index),
      ]);
    }, 800);
  };
  // モックのカーソルは「caret」の印が付いたブロックの直後
  const caretIndex = blocks.findIndex((b) => b.caret) + 1;

  return (
    <div className="flex gap-4 items-start">
      {/* ノート（モック）。段落の間に落とせる。細い線が落ちる位置 */}
      <div
        data-test="mockNote"
        style={{ width: 380, height: 560 }}
        className="bg-background border border-border rounded-lg overflow-y-auto px-6 py-5 text-sm text-foreground"
        onDragLeave={() => setDropIndex(null)}
      >
        {blocks.map((block, i) => (
          <div
            key={block.id}
            data-test="mockNoteBlock"
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(INBOX_DRAG_MIME)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              const box = e.currentTarget.getBoundingClientRect();
              setDropIndex(e.clientY < box.top + box.height / 2 ? i : i + 1);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const raw = e.dataTransfer.getData(INBOX_DRAG_MIME);
              if (raw && dropIndex != null) insertAt(JSON.parse(raw) as string[], dropIndex);
              setDropIndex(null);
            }}
            className="relative py-1.5"
          >
            {dropIndex === i && <span className="absolute inset-x-0 -top-px h-0.5 bg-primary" />}
            {block.inserted ? (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-6 text-center text-[11px] text-muted-foreground">
                {block.text}
              </div>
            ) : (
              <p className={block.heading ? "text-base font-medium" : "leading-relaxed"}>
                {block.text}
                {block.caret && <span className="ml-0.5 inline-block w-px h-4 align-middle bg-foreground animate-pulse" />}
              </p>
            )}
            {dropIndex === i + 1 && i === blocks.length - 1 && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />
            )}
          </div>
        ))}
      </div>
      <div
        style={{ width, height: 560 }}
        className="bg-background border border-border rounded-lg overflow-hidden flex flex-col"
      >
        <MobileInboxPanel
          source={connected ? (english ? fakeSourceEn : fakeSource) : null}
          items={items}
          busyNames={busy}
          onRefresh={() => setItems(initialItems)}
          onConnect={() => {}}
          // ダブルクリック・＋・まとめて入れる → カーソルの位置へ
          onInsert={(refs) => insertAt(refs.map((r) => r.name), caretIndex)}
          // 使わずに削除 → 一覧から外す（実物は同期フォルダの Inbox/ から消す）
          onDiscard={async (refs) => {
            const names = new Set(refs.map((r) => r.name));
            setItems((prev) => prev.filter((r) => !names.has(r.name)));
          }}
        />
      </div>
    </div>
  );
}

const meta: Meta<typeof PanelHost> = {
  title: "Mobile Capture / MobileInboxPanel",
  component: PanelHost,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "右パネルの受信箱。ノートを開いたまま、スマホから届いた未取り込みのものを並べる。" +
          "タイルをノート（左のモック）へドラッグすると落とした位置に、ダブルクリックか ＋ で" +
          "カーソルの位置に入る。クリックは選ぶだけ。左上のチェックか ⌘/Ctrl＋クリックで複数枚を" +
          "選ぶと、まとめてドラッグでき、下に「選んだ N 件をノートに入れる」も出る。",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof PanelHost>;

/** 実験室で撮った写真が 5 枚届いたところ。 */
export const Photos: Story = {
  args: { initialItems: PHOTOS },
};

/** 写真・メモ・URL・動画・音声が混ざった受信箱。 */
export const Mixed: Story = {
  args: { initialItems: MIXED },
};

/** 右パネルの下限の幅（320px）。 */
export const Narrow: Story = {
  args: { initialItems: MIXED, width: 320 },
};

/** 右パネルの上限の幅（480px）。3 列になる。 */
export const Wide: Story = {
  args: { initialItems: MIXED, width: 480 },
};

/** ノートに入れている最中（2 枚が待ち表示）。 */
export const Inserting: Story = {
  args: { initialItems: PHOTOS, initialBusy: [PHOTOS[0].name, PHOTOS[1].name] },
};

/** 整理が済んで空になったところ。 */
export const Empty: Story = {
  args: { initialItems: [] },
};

/** 同期フォルダが未接続。 */
export const NotConnected: Story = {
  args: { initialItems: [], connected: false },
};

/**
 * マニュアルの図用（英語・パン作り）。scripts/manual-screenshots-storybook-extra.mjs が
 * 写真を 2 枚選んだ状態で撮る。
 */
export const ManualEnglish: Story = {
  name: "Manual (English, bread world)",
  args: { initialItems: MIXED.filter((r) => !r.name.endsWith(".m4a")), english: true, width: 400 },
};
