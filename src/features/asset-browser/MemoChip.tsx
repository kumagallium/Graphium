// メモの印（付箋アイコン＋件数のピル）
// 「何かについてのメモ」が本文や一覧の上に見える形で添わる場所で共通に使う印。
// 今はノートに貼った素材（画像・動画・PDF）のブロックに付く。素材一覧・つながり（辺）でも同じ見た目を使う。
//
// 見せ方の共通の約束:
// - 件数が 1 以上なら常に出す（付箋＋数字）
// - 0 件は、対象にマウスが載っている間（または選択中）だけ薄い「＋付箋」で出す
// - タッチ端末（hover なし）では 0 件の印は出さない
// この判定は {@link isMemoChipVisible} が持つ。0 件のときの出し入れは呼び出し側が
// visible で制御する（印そのものは対象の DOM を知らない）。

import { forwardRef, type CSSProperties, type MouseEvent } from "react";
import { Plus, StickyNote } from "lucide-react";

export type MemoChipProps = {
  /** メモの件数。0 のときは数字なしの薄い「＋付箋」 */
  count: number;
  /** false のとき何も描かない（0 件の hover 表示の制御は呼び出し側） */
  visible: boolean;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  /** aria-label とツールチップ（例: 「メモ 3 件」「この素材にメモを書く」） */
  label: string;
  /** ツールチップの使い方の行（data-tooltip-usage） */
  usage?: string;
  /** 小窓を開いている間 true。0 件でも濃く見せる */
  active?: boolean;
  /** 配置（絶対配置の top/left など）は置き場所の側が決める */
  style?: CSSProperties;
  className?: string;
  /** テストや層が印を引き当てるための印（data-memo-chip の値） */
  chipId?: string;
  /**
   * 0 件の印を CSS だけで出し入れする（親の `group` に hover したとき、またはキーボードで
   * フォーカスしたときに濃くなる）。素材一覧のように行・カードが多く、hover のたびに
   * React の状態を更新したくない場所で使う。visible は呼び出し側が
   * 「1 件以上、またはタッチ端末でない」で決める
   */
  hoverReveal?: boolean;
};

/**
 * 印を出すかどうか。
 * - 1 件以上: 常に出す
 * - 0 件: hover できる端末で、対象にマウスが載っている／選択中／小窓を開いている間だけ出す
 */
export function isMemoChipVisible(input: {
  count: number;
  hovered: boolean;
  selected: boolean;
  /** 小窓を開いている（開いている間は印を消さない。小窓の起点が消えるため） */
  active?: boolean;
  /** hover できる端末か（タッチ端末は false） */
  canHover: boolean;
}): boolean {
  if (input.count > 0) return true;
  if (!input.canHover) return false;
  return input.hovered || input.selected || Boolean(input.active);
}

/** hover できる端末か（タッチ端末は false）。0 件の印を hover で出す判定の入力 */
export function canHoverDevice(): boolean {
  try {
    return window.matchMedia?.("(hover: hover)").matches ?? true;
  } catch {
    return true;
  }
}

export const MemoChip = forwardRef<HTMLButtonElement, MemoChipProps>(function MemoChip(
  { count, visible, onClick, label, usage, active = false, style, className, chipId, hoverReveal = false },
  ref,
) {
  if (!visible) return null;
  const empty = count <= 0;
  // 0 件を CSS で出し入れするとき（hoverReveal）は、普段は見えず、親の hover・キーボードの
  // フォーカス・小窓を開いている間だけ濃くなる。inline の opacity は CSS を上書きするので付けない
  const cssReveal = hoverReveal && empty;
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      // 本文のエディタから選択やフォーカスを奪わない（押す前の選択を保つ）
      onMouseDown={(e) => e.preventDefault()}
      data-tooltip={label}
      {...(usage ? { "data-tooltip-usage": usage } : {})}
      aria-label={label}
      data-memo-chip={chipId}
      data-test="memoChip"
      className={
        "inline-flex items-center justify-center gap-1 rounded-full border border-border " +
        "bg-background/90 text-muted-foreground shadow-sm text-xs leading-none " +
        "hover:text-foreground hover:bg-background transition-colors " +
        (cssReveal
          ? active
            ? "opacity-100 "
            : "opacity-0 group-hover:opacity-70 hover:opacity-100! focus-visible:opacity-100! "
          : "") +
        (className ?? "")
      }
      style={{
        height: 22,
        minWidth: 22,
        padding: empty ? "0 6px" : "0 8px",
        // 0 件は薄く（押せることは hover で濃くなって伝わる）
        ...(cssReveal ? {} : { opacity: empty && !active ? 0.7 : 1 }),
        cursor: "pointer",
        ...style,
      }}
    >
      <StickyNote size={13} aria-hidden />
      {empty ? <Plus size={10} aria-hidden /> : <span style={{ fontVariantNumeric: "tabular-nums" }}>{count}</span>}
    </button>
  );
});
