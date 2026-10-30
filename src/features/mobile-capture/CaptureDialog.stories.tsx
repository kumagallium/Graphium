// CaptureDialog（メモを書くダイアログ）のストーリー。
//
// ⌘⇧M（クイックメモ）・書式ツールバーの「メモ」・ブロックメニューの「メモを追加」で開く。
// 「いま見ているもの」が付け先になり、本文の上のチップに出る（ブロック＝¶＋抜粋、
// ノート＝書類＋題、素材＝素材の種類のアイコン＋名前）。チップの ✕ で外すと、
// どこにも付かないメモとして保存される。デスクトップは中央のカード、モバイルは全画面。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { CaptureDialog } from "./CaptureDialog";
import type { MemoTarget } from "./memo-target";
import "../../app.css";

const meta: Meta<typeof CaptureDialog> = {
  title: "Mobile Capture / CaptureDialog",
  component: CaptureDialog,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "メモを書くダイアログ。target を渡すと付け先のチップを本文の上に出し、✕ で外せる（外すと none として onSubmit に渡る）。" +
          "target が none または無いときはチップを出さない。",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof CaptureDialog>;

/** 送信した結果（付け先を含む）を画面の下に出して、✕ で外した効果が見えるようにする */
function Harness({ target, targetRemovable }: { target?: MemoTarget; targetRemovable?: boolean }) {
  const [last, setLast] = useState<string>("");
  return (
    <div style={{ minHeight: 420 }}>
      <CaptureDialog
        variant="centered"
        target={target}
        targetRemovable={targetRemovable}
        folderOptions={["実験", "文献"]}
        defaultFolder="実験"
        submitting={false}
        onSubmit={async (text, folder, t) => {
          setLast(JSON.stringify({ text, folder, target: t?.kind ?? "(未指定)" }));
        }}
        onClose={() => {}}
      />
      {last && (
        <p style={{ position: "fixed", bottom: 12, left: 12, zIndex: 200 }} className="text-xs text-white">
          送信: {last}
        </p>
      )}
    </div>
  );
}

/** 付け先なし（一覧・ホームで開いたとき）。チップは出ない */
export const NoTarget: Story = {
  render: () => <Harness target={{ kind: "none" }} />,
};

/** ノートのブロックにカーソルがあるとき: ¶＋ブロックの抜粋 */
export const OnBlock: Story = {
  render: () => (
    <Harness
      target={{
        kind: "block",
        fileId: "n1",
        title: "SEM 観察 2026-10",
        blockId: "b1",
        blockText: "900 ℃ で焼鈍した試料の断面。粒界に析出物が見える",
      }}
    />
  ),
};

/** ノートを開いているだけのとき: 書類アイコン＋ノートの題 */
export const OnNote: Story = {
  render: () => <Harness target={{ kind: "note", fileId: "n1", title: "SEM 観察 2026-10" }} />,
};

/** 素材を全画面・ピークで見ているとき: 素材の種類のアイコン＋名前 */
export const OnAsset: Story = {
  render: () => (
    <Harness target={{ kind: "asset", fileId: "img-1", type: "image", name: "sem-900c-x5000.png" }} />
  ),
};

/** ブロックメニュー「メモを追加」: 付け先そのものが目的なので ✕ は出さない */
export const BlockMenuNotRemovable: Story = {
  render: () => (
    <Harness
      targetRemovable={false}
      target={{ kind: "block", fileId: "n1", blockId: "b1", blockText: "粒界に析出物が見える" }}
    />
  ),
};

/** 抜粋がとても長いとき: 1 行に切り詰めて、全文は title に */
export const LongLabel: Story = {
  render: () => (
    <Harness
      target={{
        kind: "block",
        fileId: "n1",
        blockId: "b1",
        blockText: "とても長い抜粋。".repeat(10),
      }}
    />
  ),
};

/** モバイルの全画面でも同じチップ */
export const FullscreenOnNote: Story = {
  render: () => (
    <div style={{ width: 390, height: 640, position: "relative", overflow: "hidden", transform: "translateZ(0)", border: "1px solid var(--color-border)" }}>
      <CaptureDialog
        variant="fullscreen"
        target={{ kind: "note", fileId: "n1", title: "SEM 観察 2026-10" }}
        submitting={false}
        onSubmit={async () => {}}
        onClose={() => {}}
      />
    </div>
  ),
};
