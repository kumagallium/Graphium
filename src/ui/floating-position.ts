// 浮かせるメニュー・小窓の位置を「画面（ビューポート）に全部収まる」基準で決める共通関数。
// 好みの側に収まらなければ反対側へ折り返し（flip）、それでも足りなければ広い側に置いて
// maxHeight を縮める。交差軸は画面の内側へ押し戻す（clamp）。
import { useLayoutEffect, useState } from "react";

export type Rect = { top: number; left: number; bottom: number; right: number };
export type Placement =
  | "bottom-start"
  | "bottom-end"
  | "top-start"
  | "top-end"
  | "right-start"
  | "left-start";

export type PlaceFloatingArgs = {
  /** 起点（ボタンの矩形。右クリックなら幅 0 の点） */
  anchor: Rect;
  /** 小窓の実寸（描いてから測る） */
  size: { width: number; height: number };
  viewport: { width: number; height: number };
  /** 既定 bottom-start */
  placement?: Placement;
  /** 起点との間（既定 4） */
  gap?: number;
  /** 画面の端との余白（既定 8） */
  margin?: number;
};

export type PlaceFloatingResult = {
  top: number;
  left: number;
  /** 置いた側の空き（縦の高さの上限）。小窓が収まるなら実寸以上の値 */
  maxHeight: number;
  /** 実際に置いた向き（flip 後） */
  placement: Placement;
};

/** lo ≤ v ≤ hi に押し込む。範囲が逆転したら lo を優先（画面より大きい小窓は端に寄せる） */
function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.min(Math.max(v, lo), hi);
}

export function placeFloating(args: PlaceFloatingArgs): PlaceFloatingResult {
  const { anchor, size, viewport } = args;
  const placement = args.placement ?? "bottom-start";
  const gap = args.gap ?? 4;
  const margin = args.margin ?? 8;

  const [side, align] = placement.split("-") as [
    "bottom" | "top" | "right" | "left",
    "start" | "end",
  ];

  // 横向き（子メニュー）: 主軸は左右、交差軸は上下
  if (side === "right" || side === "left") {
    const spaceRight = viewport.width - anchor.right - gap - margin;
    const spaceLeft = anchor.left - gap - margin;
    let use: "right" | "left" = side;
    const pref = side === "right" ? spaceRight : spaceLeft;
    const other = side === "right" ? spaceLeft : spaceRight;
    if (size.width > pref && (size.width <= other || other > pref)) {
      use = side === "right" ? "left" : "right";
    }
    const rawLeft =
      use === "right" ? anchor.right + gap : anchor.left - gap - size.width;
    const left = clamp(rawLeft, margin, viewport.width - size.width - margin);
    const maxHeight = Math.max(0, viewport.height - margin * 2);
    const h = Math.min(size.height, maxHeight);
    const top = clamp(anchor.top, margin, viewport.height - h - margin);
    return { top, left, maxHeight, placement: `${use}-start` };
  }

  // 縦向き: 主軸は上下、交差軸は左右
  const spaceBelow = viewport.height - anchor.bottom - gap - margin;
  const spaceAbove = anchor.top - gap - margin;
  const pref = side === "bottom" ? spaceBelow : spaceAbove;
  const other = side === "bottom" ? spaceAbove : spaceBelow;
  let use: "bottom" | "top" = side;
  if (size.height > pref && (size.height <= other || other > pref)) {
    use = side === "bottom" ? "top" : "bottom";
  }
  const maxHeight = Math.max(0, use === "bottom" ? spaceBelow : spaceAbove);
  const h = Math.min(size.height, maxHeight);
  const top = use === "bottom" ? anchor.bottom + gap : anchor.top - gap - h;
  const rawLeft = align === "start" ? anchor.left : anchor.right - size.width;
  const left = clamp(rawLeft, margin, viewport.width - size.width - margin);
  return { top, left, maxHeight, placement: `${use}-${align}` };
}

/**
 * 開いたとき・scroll（capture）・resize で測り直し、placeFloating の結果を返す。
 * 測り直しは rAF で 1 回にまとめる。el は描画済みの小窓、anchor は Rect か要素。
 * 開く前・el 未確定の間は null。
 */
export function useFloatingPlacement(
  anchor: Element | Rect | null,
  el: HTMLElement | null,
  open: boolean,
  opts: Pick<PlaceFloatingArgs, "placement" | "gap" | "margin"> = {},
  deps: ReadonlyArray<unknown> = [],
): PlaceFloatingResult | null {
  const [result, setResult] = useState<PlaceFloatingResult | null>(null);
  const { placement, gap, margin } = opts;

  useLayoutEffect(() => {
    if (!open || !anchor || !el) {
      setResult(null);
      return;
    }
    let raf = 0;
    const measure = () => {
      const a =
        "getBoundingClientRect" in anchor
          ? anchor.getBoundingClientRect()
          : anchor;
      const r = el.getBoundingClientRect();
      const next = placeFloating({
        anchor: { top: a.top, left: a.left, bottom: a.bottom, right: a.right },
        size: { width: r.width, height: r.height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        placement,
        gap,
        margin,
      });
      setResult((prev) =>
        prev &&
        prev.top === next.top &&
        prev.left === next.left &&
        prev.maxHeight === next.maxHeight &&
        prev.placement === next.placement
          ? prev
          : next,
      );
    };
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    };
    measure();
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, el, open, placement, gap, margin, ...deps]);

  return result;
}
