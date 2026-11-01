// MemoQuotePopover のストーリー
// 引用したメモの小窓。引用ブロック右上の印（MemoChip）に付けて開く。
// 元のメモの今の本文と引用日時を出し、状態に応じて「本文に反映」「紐づけを外す」「メモを開く」を並べる。
// 書く欄は出さない。Esc・外側クリックで閉じる（閉じたら「開く」で開き直せる）。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { MemoChip } from "../asset-browser/MemoChip";
import { MemoQuotePopover } from "./MemoQuotePopover";
import type { MemoQuoteStatus } from "./memo-quote";
import type { CaptureEntry } from "../mobile-capture";
import "../../app.css";

const meta: Meta = {
  title: "Memo Quote / MemoQuotePopover",
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "引用したメモの小窓。synced（引用時のまま）／updated（元のメモが更新されている。「本文に反映」で今のメモの本文に置き換える。自動では書き換えない）／deleted（元のメモは削除された。本文はそのまま）。アーカイブ・ゴミ箱のノートでは反映・解除を出さない。",
      },
    },
  },
};
export default meta;
type Story = StoryObj;

const MEMO: CaptureEntry = {
  id: "cap_1",
  text: "SEM 像。粒界に析出物が見える。組成分析を追加したい。\n\n— sem-900c-x5000.png",
  createdAt: "2026-10-30T10:20:00.000Z",
};
const REF = {
  captureId: "cap_1",
  quotedAt: "2026-10-30T11:05:00.000Z",
  quotedText: "SEM 像。粒界に析出物が見える。\n\n— sem-900c-x5000.png",
};

function Demo({
  status,
  memo = MEMO,
  editable = true,
}: {
  status: MemoQuoteStatus;
  memo?: CaptureEntry;
  editable?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [chipEl, setChipEl] = useState<HTMLButtonElement | null>(null);
  return (
    <div style={{ width: 420, height: 420, display: "flex", justifyContent: "flex-end", alignItems: "flex-start" }}>
      <MemoChip
        ref={setChipEl}
        count={1}
        hideCount
        dot={status === "updated"}
        visible
        active={open}
        label="メモ"
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <MemoQuotePopover
          anchor={chipEl}
          quoteRef={REF}
          status={status}
          memo={status === "deleted" ? undefined : memo}
          editable={editable}
          onOpenMemo={(id) => console.log("open memo", id)}
          onReflect={() => console.log("reflect")}
          onUnlink={() => console.log("unlink")}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/** 引用したときのまま */
export const Synced: Story = { render: () => <Demo status="synced" /> };

/** 元のメモが引用後に変わっている（「本文に反映」が出る） */
export const Updated: Story = {
  render: () => (
    <Demo
      status="updated"
      memo={{ ...MEMO, text: "SEM 像。粒界に析出物が見える。EDS で Zr を確認した。\n\n— sem-900c-x5000.png" }}
    />
  ),
};

/** 元のメモがゴミ箱・完全削除。本文は残る */
export const Deleted: Story = { render: () => <Demo status="deleted" /> };

/** 読むだけ（アーカイブ・ゴミ箱のノート）。反映・解除を出さない */
export const ReadOnly: Story = { render: () => <Demo status="updated" editable={false} /> };
