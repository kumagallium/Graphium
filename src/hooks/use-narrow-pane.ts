// 本文枠の幅を測って「狭いか」を返すフック。判定の基準は lib/pane-layout.ts。
//
// 枠の幅は右パネル・サイドバー・サイドピークの開閉とウィンドウのリサイズで変わる。
// どれも枠自身の寸法変化として現れるので、ResizeObserver 1 本で足りる。
// border box（offsetWidth）で測る: clientWidth だと縦スクロールバーの出入りで 15px 動き、
// 境目の幅で「狭い ⇄ 広い」が行き来する（Windows の常時スクロールバー）。
// 枠の幅は中の余白に依らない（flex-1 と minWidth で決まる）ので、判定が余白を変えて
// 幅が変わり判定が戻る、というループにはならない。

import { useLayoutEffect, useState } from "react";
import { isNarrowPane } from "../lib/pane-layout";

export function useNarrowPane(paneEl: HTMLElement | null, enabled: boolean): boolean {
  const [narrow, setNarrow] = useState(false);

  // 描画の前に測る（最初の 1 フレームだけ広い余白で描いて、すぐ詰まる、を避ける）
  useLayoutEffect(() => {
    if (!paneEl || !enabled) {
      setNarrow(false);
      return;
    }
    const apply = () => setNarrow(isNarrowPane(paneEl.offsetWidth));
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(paneEl);
    return () => ro.disconnect();
  }, [paneEl, enabled]);

  return narrow;
}
