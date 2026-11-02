// 書式ツールバーの「メモ」ボタン（付箋アイコン）。
//
// 文字を選んだとき（選んだ文にメモ）と、素材ブロックを選んだとき（その素材のメモの小窓）の
// 2 か所で同じ見た目を使う。出す条件は memo-toolbar.ts が持つので、ここでは描くだけ。
// サイズは同じツールバーに並ぶ BlockNote 標準ボタンに合わせて 36px 角・rounded-md
// （ImageOpenPeekButton と同じ規格）。

import { StickyNote } from "lucide-react";

type Props = {
  onOpen: () => void;
  /** ツールチップの名前（aria-label も同じ） */
  name: string;
  /** ツールチップの使い方の行 */
  usage?: string;
  /** テスト・E2E 用の識別（data-test） */
  testId?: string;
};

export function MemoToolbarButton({ onOpen, name, usage, testId = "memoToolbarButton" }: Props) {
  return (
    <button
      type="button"
      onClick={onOpen}
      // ツールバーを押してもエディタの選択を外さない（押す前の選択を保つ）
      onMouseDown={(e) => e.preventDefault()}
      data-tooltip={name}
      {...(usage ? { "data-tooltip-usage": usage } : {})}
      aria-label={name}
      className="bn-button inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-black/5 transition-colors"
      data-test={testId}
    >
      <StickyNote size={18} />
    </button>
  );
}
