// 手順フローの線の削除メニューを、パネルの内側（とビューポート）に収めるための計算。
// メニューは線をクリックした位置を中心に置くので、端に寄った線では、フローのパネルの
// overflow:hidden や画面の端で切られる。はみ出した分だけ内側へ押し戻す（大きさは変えない）。
export type BoxRect = { left: number; top: number; right: number; bottom: number };

/** 2 つの矩形の共通部分。重ならなければ a を返す（押し戻せる範囲が無いので何もしない） */
export function intersectRects(a: BoxRect, b: BoxRect): BoxRect {
  const r = {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
  return r.right > r.left && r.bottom > r.top ? r : a;
}

function shiftAxis(lo: number, hi: number, boundLo: number, boundHi: number, margin: number): number {
  const min = boundLo + margin;
  const max = boundHi - margin;
  // 境界より大きいときは、始まり側（左・上）を揃える
  if (hi - lo > max - min) return min - lo;
  if (lo < min) return min - lo;
  if (hi > max) return max - hi;
  return 0;
}

/** rect を bounds の内側（margin 空ける）へ入れるのに要る移動量 */
export function fitInside(
  rect: BoxRect,
  bounds: BoxRect,
  margin = 4,
): { dx: number; dy: number } {
  return {
    dx: shiftAxis(rect.left, rect.right, bounds.left, bounds.right, margin),
    dy: shiftAxis(rect.top, rect.bottom, bounds.top, bounds.bottom, margin),
  };
}
