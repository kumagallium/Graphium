// 素材の一覧に出すリンクした素材の「いまの状態」をまとめて取るフック。
//
// 表示している素材のうちリンクしたものだけを、statLinks 1 回でまとめて見る。
// 呼ぶのは マウント時・対象の一覧が変わったとき・ウィンドウにフォーカスが戻ったとき。
// デスクトップ版でなければ何も呼ばない（空の Map のまま）。

import { useEffect, useMemo, useState } from "react";
import { isTauri } from "../../lib/platform";
import type { MediaIndexEntry } from "../asset-browser/media-index";
import { isLinkedEntry } from "./link-url";
import { linkState, type LinkState } from "./linked-entry";
import { statLinks } from "./places";

const EMPTY: ReadonlyMap<string, LinkState> = new Map();

export function useLinkStates(entries: readonly MediaIndexEntry[]): ReadonlyMap<string, LinkState> {
  const [states, setStates] = useState<ReadonlyMap<string, LinkState>>(EMPTY);

  // 対象のリンクした素材。控え（大きさ・更新日時）も鍵に含め、控え直したら状態を引き直す
  const targets = useMemo(() => entries.filter(isLinkedEntry), [entries]);
  const key = targets
    .map((e) => `${e.fileId}\t${e.link!.placeId}\t${e.link!.relPath}\t${e.link!.size}\t${e.link!.mtimeMs}`)
    .join("\n");

  useEffect(() => {
    if (!isTauri() || targets.length === 0) {
      setStates(EMPTY);
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const stats = await statLinks(targets.map((e) => ({ placeId: e.link!.placeId, relPath: e.link!.relPath })));
        if (cancelled) return;
        const next = new Map<string, LinkState>();
        targets.forEach((e, i) => {
          const stat = stats[i];
          if (stat) next.set(e.fileId, linkState(e.link!, stat));
        });
        setStates(next);
      } catch (err) {
        // 取れなかったときは前の状態のまま（一覧の表示は止めない）
        console.warn("リンクした素材の状態を取れませんでした:", err);
      }
    };
    void run();
    const onFocus = () => void run();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return states;
}
