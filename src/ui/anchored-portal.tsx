// 本文の枠（overflow:auto）の中に absolute で描いていた自前の小窓を、body 直下へ出して
// position:fixed で置くための共通部品。位置は floating-position.ts（画面に全部収まる基準）で
// 決め、開いている間は scroll・resize で追従する。
//
// 使い方: 小窓の中身をこれで包む。外側クリックの判定は「起点の入れ物 contains」に加えて
// containerRef（この部品の実 DOM）の contains も見ること（Portal 先は入れ物の外にある）。
import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type MutableRefObject,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import {
  useFloatingPlacement,
  type PlaceFloatingArgs,
  type Rect,
} from "./floating-position";

/** ピーク（100）・全画面ダイアログより上、Dropdown（9999）と同じ帯 */
export const ANCHORED_PORTAL_Z_INDEX = 9999;

type Props = Omit<HTMLAttributes<HTMLDivElement>, "ref"> & {
  /** 起点（ボタンなどの要素、または矩形）。null の間は何も描かない */
  anchor: Element | Rect | null;
  placement?: PlaceFloatingArgs["placement"];
  gap?: number;
  margin?: number;
  /** 実 DOM の ref（外側クリックの contains 判定用） */
  containerRef?: Ref<HTMLDivElement>;
  /** 中身の高さが変わる小窓は、変わる値を渡して測り直させる */
  deps?: ReadonlyArray<unknown>;
};

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === "function") ref(value);
  else (ref as MutableRefObject<T | null>).current = value;
}

export function AnchoredPortal({
  anchor,
  placement,
  gap,
  margin,
  containerRef,
  deps,
  style,
  children,
  ...rest
}: Props) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      setEl(node);
      assignRef(containerRef, node);
    },
    [containerRef],
  );
  // 中身の大きさが変わったら測り直す（tick）。maxHeight で実際に縮んだときだけ scroll を許す
  // （常時 overflow を付けると子の box-shadow が入れ物の枠で切れるため）
  const [tick, setTick] = useState(0);
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      setTick((t) => t + 1);
      setClipped(el.scrollHeight > el.clientHeight + 1);
    });
    ro.observe(el);
    Array.from(el.children).forEach((c) => ro.observe(c));
    return () => ro.disconnect();
  }, [el]);
  const placed = useFloatingPlacement(
    anchor,
    el,
    true,
    { placement, gap, margin },
    [...(deps ?? []), tick],
  );
  // maxHeight が変わった直後にも判定し直す
  useEffect(() => {
    if (el) setClipped(el.scrollHeight > el.clientHeight + 1);
  }, [el, placed?.maxHeight, tick]);
  if (!anchor || typeof document === "undefined") return null;

  const fixedStyle: CSSProperties = {
    ...style,
    position: "fixed",
    top: placed ? placed.top : 0,
    left: placed ? placed.left : 0,
    bottom: "auto",
    right: "auto",
    // 収まる場合は実寸以上の値なので、そのまま渡してよい。呼び出し側が数値の maxHeight を
    // 持っているときは、それを超えて伸ばさないよう小さいほうを取る
    maxHeight: placed
      ? typeof style?.maxHeight === "number"
        ? Math.min(style.maxHeight, placed.maxHeight)
        : placed.maxHeight
      : style?.maxHeight,
    overflowY: clipped ? "auto" : undefined,
    zIndex: ANCHORED_PORTAL_Z_INDEX,
    // 実寸を測るまでの 1 フレームは見せない（左上に一瞬出るのを防ぐ）
    visibility: placed ? undefined : "hidden",
  };
  return createPortal(
    <div ref={setRef} style={fixedStyle} {...rest}>
      {children}
    </div>,
    document.body,
  );
}
