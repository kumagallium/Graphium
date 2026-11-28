// 長い一覧を、スクロールに合わせて少しずつ描くためのフック。
//
// ナレッジの一覧（知見）は数千行になり、全行を DOM に置くと 10 万要素を超える。
// そうなると、ページを開くたびに BlockNote が <html> の CSS 変数（--bn-vv-*）を書き換えるだけで
// 文書全体のスタイル計算が走り、数秒止まっていた。描く行を画面の近くまでに抑えて DOM を小さく保つ。
//
// - 最初は `step` 行だけ描き、末尾の目印（sentinel）がスクロール枠の下端に近づいたら `step` 行ずつ足す
// - `resetKey` が変わったら（絞り込み・並べ替え・種類の切り替え）最初の `step` 行に戻す
// - 全選択・範囲選択などはデータ（行の配列）で動くので、描いていない行も対象になる

import { useCallback, useEffect, useRef, useState } from "react";

/** 一度に描く行数の既定値 */
export const INCREMENTAL_ROWS_STEP = 200;

/** 末尾の目印がスクロール枠の下端からこの距離に入ったら次を描く */
const PRELOAD_MARGIN_PX = 800;

export function useIncrementalRows(total: number, resetKey: unknown, step = INCREMENTAL_ROWS_STEP) {
  const [count, setCount] = useState(step);
  const [sentinel, setSentinel] = useState<Element | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);

  // 絞り込み・並べ替えが変わったら先頭から描き直す
  const lastKeyRef = useRef(resetKey);
  if (lastKeyRef.current !== resetKey) {
    lastKeyRef.current = resetKey;
    if (count !== step) setCount(step);
  }

  const visible = Math.min(total, count);
  const hasMore = visible < total;

  useEffect(() => {
    if (!sentinel || !hasMore || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setCount((c) => c + step);
      },
      { root: rootRef.current, rootMargin: `0px 0px ${PRELOAD_MARGIN_PX}px 0px` },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
    // visible を入れる: 足したあとも目印が見えたままなら、観測し直して続きを描く
  }, [sentinel, hasMore, step, visible]);

  /** 末尾の目印に付ける ref（hasMore のときだけ描く） */
  const sentinelRef = useCallback((el: Element | null) => setSentinel(el), []);

  return { visible, hasMore, sentinelRef, rootRef };
}
