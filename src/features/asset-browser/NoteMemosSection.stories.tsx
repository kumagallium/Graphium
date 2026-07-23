// NoteMemosSection のストーリー
// ノート編集画面 右パネル「Memos」タブの中身。
// ブロック紐付きメモ（sourceNote.blockId + blockText）は ¶ テキスト抜粋チップを表示し、
// カードクリックで該当ブロックのハイライト + スクロールを親に依頼する
// （Storybook では対象ブロックが無いため console.log のみ。選択スタイルは確認できる）。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { NoteMemosSection } from "./NoteMemosSection";
import type { CaptureIndex } from "../mobile-capture";
import "../../app.css";

const meta: Meta = {
  title: "Asset Browser / NoteMemosSection",
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "ノート右パネル「Memos」タブ。ノート単位メモとブロック紐付きメモ（¶ チップ付き）が混在する。",
      },
    },
  },
};
export default meta;
type Story = StoryObj;

const NOTE_FILE_ID = "note:story";

const captureIndex: CaptureIndex = {
  version: 1,
  updatedAt: "2026-07-23T10:00:00.000Z",
  captures: [
    {
      id: "cap_block_1",
      text: "この段落の主張、XRD の結果と矛盾していないか後で確認する。",
      createdAt: "2026-07-23T09:45:00.000Z",
      sourceNote: {
        fileId: NOTE_FILE_ID,
        title: "実験ノート 7/23",
        blockId: "block-claim",
        blockText: "焼成温度を 900°C に上げると導電率が一桁向上した",
      },
    },
    {
      id: "cap_block_2",
      text: "SEM 像。粒界に析出物が見える。組成分析を追加したい。",
      createdAt: "2026-07-23T09:30:00.000Z",
      sourceNote: {
        fileId: NOTE_FILE_ID,
        title: "実験ノート 7/23",
        blockId: "block-image",
        blockText: "sem-900c-x5000.png",
      },
    },
    {
      id: "cap_note_level",
      text: "このノート全体を来週のゼミ資料の骨子にする。",
      createdAt: "2026-07-23T09:00:00.000Z",
      sourceNote: { fileId: NOTE_FILE_ID, title: "実験ノート 7/23" },
      usedIn: [
        { noteId: "note:other", noteTitle: "ゼミ資料", insertedAt: "2026-07-23T09:10:00.000Z" },
      ],
    },
  ],
};

function PanelFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-[360px] border border-border-subtle rounded-lg bg-card overflow-hidden">
      {children}
    </div>
  );
}

// ── ノート単位 + ブロック紐付きの混在（標準表示） ─────────────
// ブロック紐付きメモのカードをクリックすると選択スタイル（青背景 + 左ボーダー）
// が付き、onHighlightBlock に blockId が渡る（再クリックで解除）。
// ¶ チップは resolveBlockLabel でライブ解決される:
//   - block-claim → 編集後の現在テキスト（ライブ）が出る
//   - block-image → null（ブロック削除済みを模擬）→ 作成時スナップショットに
//     フォールバック
export const Mixed: Story = {
  name: "混在（ノート単位 + ブロック紐付き）",
  render: () => (
    <PanelFrame>
      <NoteMemosSection
        noteFileId={NOTE_FILE_ID}
        noteTitle="実験ノート 7/23"
        captureIndex={captureIndex}
        onDeleteMemo={(id) => console.log("[NoteMemosSection] delete:", id)}
        onCreateMemo={async (text) => console.log("[NoteMemosSection] create:", text)}
        onHighlightBlock={(blockId) =>
          console.log("[NoteMemosSection] highlight:", blockId)
        }
        resolveBlockLabel={(blockId) =>
          blockId === "block-claim"
            ? "焼成温度を 950°C に上げると導電率が二桁向上した（編集後）"
            : null
        }
      />
    </PanelFrame>
  ),
};

// ── 空状態 ─────────────
export const Empty: Story = {
  name: "空状態",
  render: () => (
    <PanelFrame>
      <NoteMemosSection
        noteFileId={NOTE_FILE_ID}
        noteTitle="実験ノート 7/23"
        captureIndex={{ version: 1, updatedAt: "2026-07-23T10:00:00.000Z", captures: [] }}
        onCreateMemo={async (text) => console.log("[NoteMemosSection] create:", text)}
      />
    </PanelFrame>
  ),
};
