// MemoChip のストーリー
// メモの印（付箋アイコン＋件数のピル）。ノートに貼った素材（画像・動画・PDF）の絵の内側の右上に
// 重ねて使う（素材一覧・つながりでも同じ見た目）。
// 見せ方の約束: 1 件以上は常に出す／0 件はマウスが載っている間（または選択中）だけ薄い「＋付箋」。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { MemoChip } from "./MemoChip";
import "../../app.css";

const meta: Meta<typeof MemoChip> = {
  title: "Asset Browser / MemoChip",
  component: MemoChip,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "メモの印。1 件以上は付箋＋件数を常に表示、0 件は対象にマウスが載っている間だけ薄い「＋付箋」を出す（出し入れは呼び出し側が visible で制御）。",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof MemoChip>;

/** 画像に見立てた枠。右上から内側 8px に印を置く（実際は MemoBlockLayer が置く） */
function FakeImage({ children, hoverable }: { children: (hovered: boolean) => React.ReactNode; hoverable?: boolean }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => hoverable && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        width: 360,
        height: 220,
        borderRadius: 6,
        background: "linear-gradient(135deg, #cfd8cf 0%, #e8ece6 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#6b7a6b",
        fontSize: 12,
      }}
    >
      {hoverable ? "マウスを載せてみてください" : "sem-900c-x5000.png"}
      <div style={{ position: "absolute", top: 8, right: 8 }}>{children(hovered)}</div>
    </div>
  );
}

/** 3 件。常に出る（数字つき） */
export const ThreeMemos: Story = {
  render: () => (
    <FakeImage>
      {() => <MemoChip count={3} visible label="メモ 3 件" usage="押すと、この素材のメモを読んだり、その場で書いたりできます" onClick={() => {}} />}
    </FakeImage>
  ),
};

/** 0 件。マウスが載っている間だけ薄い「＋付箋」が出る */
export const ZeroMemosOnHover: Story = {
  render: () => (
    <FakeImage hoverable>
      {(hovered) => <MemoChip count={0} visible={hovered} label="この素材にメモを書く" usage="押すと、この素材のメモを読んだり、その場で書いたりできます" onClick={() => {}} />}
    </FakeImage>
  ),
};

/** 並べて比べる: 0 件（薄い）／0 件で小窓を開いている（濃い）／1 件／12 件 */
export const Variants: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <MemoChip count={0} visible label="この素材にメモを書く" onClick={() => {}} />
      <MemoChip count={0} visible active label="この素材にメモを書く" onClick={() => {}} />
      <MemoChip count={1} visible label="メモ 1 件" onClick={() => {}} />
      <MemoChip count={12} visible label="メモ 12 件" onClick={() => {}} />
    </div>
  ),
};

/** 引用ブロック用: 件数を出さず付箋だけ（hideCount）。元のメモが更新されていれば小さな点（dot） */
export const QuoteBlockVariants: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      <MemoChip count={1} hideCount visible label="メモ" onClick={() => {}} />
      <MemoChip count={1} hideCount dot visible label="メモ（元のメモが更新されています）" onClick={() => {}} />
    </div>
  ),
};
