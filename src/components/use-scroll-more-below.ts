// スクロール容器の「下にまだ続きがある」ことを知らせるためのフック。
// サイドバーは高さ 620px 以下で、下の 5 項目（スキル・全体グラフ・設定・ゴミ箱・Release Notes）が
// 中段と一緒にスクロールする。macOS のオーバーレイ式スクロールバーは止まっている間は消えるので、
// 下に項目があることに気づけない。そこで、続きがあるあいだだけ下端に薄いフェードを出す。

import { useCallback, useEffect, useState } from "react";

/** 下端まで残りがこれ以下なら「一番下」とみなす px（サブピクセルの丸めで消えないように余裕を持たせる） */
export const MORE_BELOW_THRESHOLD = 4;

/**
 * スクロール容器の下に、まだ見えていない続きがあるか。
 * scrollHeight が clientHeight 以下（スクロールできない）なら false。
 */
export function hasMoreBelow(
  el: { scrollTop: number; clientHeight: number; scrollHeight: number },
  threshold = MORE_BELOW_THRESHOLD,
): boolean {
  return el.scrollHeight - el.clientHeight - el.scrollTop > threshold;
}

/** matchMedia が無い環境（jsdom など）では false（= 常に「該当しない」）にする安全版 */
function matchesQuery(query: string): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(query).matches;
}

/**
 * query に一致している間だけ、要素のスクロール状態を見て「下に続きがあるか」を返す。
 * 戻り値の ref をスクロール容器に付ける（コールバック ref）。
 * - 一致していない（高い画面で固定のとき）は常に false
 * - スクロール・容器と直下の子の寸法変化（セクションの開閉など）で測り直す
 * - 一番下までスクロールすると false
 */
export function useScrollMoreBelow(query: string): {
  ref: (el: HTMLElement | null) => void;
  moreBelow: boolean;
} {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [active, setActive] = useState(() => matchesQuery(query));
  const [moreBelow, setMoreBelow] = useState(false);
  const ref = useCallback((node: HTMLElement | null) => setEl(node), []);

  // クエリの一致（ウィンドウの高さの変化）を追う
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = () => setActive(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  useEffect(() => {
    if (!el || !active) {
      setMoreBelow(false);
      return;
    }
    const measure = () => setMoreBelow(hasMoreBelow(el));
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(el);
      // 中身の高さが変わる（ツリーの開閉・項目の増減）と scrollHeight だけが変わる
      for (const child of Array.from(el.children)) ro.observe(child);
    }
    return () => {
      el.removeEventListener("scroll", measure);
      ro?.disconnect();
    };
  }, [el, active]);

  return { ref, moreBelow };
}
