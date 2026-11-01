// MemoPopover のストーリー
// メモの小窓。印（MemoChip）に付けて開き、メモを読む・その場で書く。
// 素材ブロックでは見出し＝素材の名前、見出しの右に「全画面で開く」、書く欄は素材についてのメモ。
// Esc・外側クリックで閉じる（Storybook では閉じたら「開く」ボタンで開き直せる）。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Maximize2 } from "lucide-react";
import { MemoChip } from "./MemoChip";
import { MemoPopover } from "./MemoPopover";
import type { CaptureEntry } from "../mobile-capture";
import "../../app.css";

const meta: Meta = {
  title: "Asset Browser / MemoPopover",
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "メモの小窓（幅 320px）。見出し → 書く欄（書けるときだけ）→ メモの一覧（新しい順）。一覧の項目を押すとメモのピークを開く。小窓では削除させない。",
      },
    },
  },
};
export default meta;
type Story = StoryObj;

const MEMOS: CaptureEntry[] = [
  {
    id: "m1",
    text: "SEM 像。粒界に析出物が見える。組成分析を追加したい。",
    createdAt: "2026-10-30T10:20:00.000Z",
  },
  {
    id: "m2",
    text: "この倍率だと粒径の分布は読めない。x10000 を撮り直す。\n\n— sem-900c-x5000.png",
    createdAt: "2026-10-29T15:05:00.000Z",
    usedIn: [{ noteId: "n1", noteTitle: "実験ノート 10/29", insertedAt: "2026-10-29T16:00:00.000Z" }],
  },
  {
    id: "m3",
    text: "撮影条件: 加速電圧 15 kV、WD 8 mm。",
    createdAt: "2026-10-28T09:40:00.000Z",
  },
];

/** 印を起点に小窓を開く枠。実際は MemoBlockLayer が同じ組み合わせで使う */
function Demo({
  memos,
  writable,
  withFullOpen = true,
  title = "sem-900c-x5000.png",
}: {
  memos: CaptureEntry[];
  writable: boolean;
  withFullOpen?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(true);
  const [list, setList] = useState(memos);
  // 印の要素は描画後に決まるので state で持つ（小窓が起点を受け取れるように）
  const [chipEl, setChipEl] = useState<HTMLButtonElement | null>(null);
  return (
    <div style={{ width: 420, height: 420, display: "flex", justifyContent: "flex-end", alignItems: "flex-start" }}>
      <MemoChip
        ref={setChipEl}
        count={list.length}
        visible
        active={open}
        label={list.length > 0 ? `メモ ${list.length} 件` : "この素材にメモを書く"}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <MemoPopover
          anchor={chipEl}
          title={title}
          headerAction={
            withFullOpen ? (
              <button
                type="button"
                aria-label="全画面で開く"
                data-tooltip="全画面で開く"
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-black/5 hover:text-foreground transition-colors"
              >
                <Maximize2 size={13} />
              </button>
            ) : undefined
          }
          memos={list}
          onCreate={
            writable
              ? async (text) => {
                  setList((prev) => [
                    { id: `new-${prev.length}`, text, createdAt: new Date().toISOString() },
                    ...prev,
                  ]);
                }
              : undefined
          }
          placeholder="この素材にメモを書く… ⏎ で保存・Shift+⏎ で改行"
          onOpenMemo={(id) => console.log("open memo", id)}
          emptyText={writable ? "まだメモはありません。上の欄から書けます。" : "この素材に紐づくメモはまだありません。"}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/** メモが複数。書くと一覧の先頭に即反映される */
export const WithMemos: Story = {
  render: () => <Demo memos={MEMOS} writable />,
};

/** まだメモが無い。書く欄にフォーカスが当たって開く */
export const Empty: Story = {
  render: () => <Demo memos={[]} writable />,
};

/** 読むだけ（アーカイブ・ゴミ箱のノート）。書く欄を出さない */
export const ReadOnly: Story = {
  render: () => <Demo memos={MEMOS} writable={false} />,
};

/** 見出しが長いとき。切り詰めて、全文は title 属性（ホバーで見える） */
export const LongTitle: Story = {
  render: () => (
    <Demo
      memos={MEMOS.slice(0, 1)}
      writable
      title="2026-10-30_sample-A_annealed-900C_cross-section_SEM_secondary-electron_x5000_final-v3.png"
    />
  ),
};
