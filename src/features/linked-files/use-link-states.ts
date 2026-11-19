// 素材の一覧に出すリンクした素材の「いまの状態」をまとめて取るフック。
//
// 表示している素材のうちリンクしたものだけを、statLinks 1 回でまとめて見る。
// 呼ぶのは マウント時・対象の一覧が変わったとき・ウィンドウにフォーカスが戻ったとき。
// 進行中の呼び出しがあるあいだは重ねて呼ばず、終わったあとに必要なら 1 回だけ呼び直す
// （止まった置き場で呼び出しが積み重なるのを防ぐ）。
// デスクトップ版でなければ何も呼ばない（空の Map のまま）。

import { useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "../../lib/platform";
import type { MediaIndexEntry } from "../asset-browser/media-index";
import { isLinkedEntry } from "./link-url";
import { linkState, type LinkState } from "./linked-entry";
import { statLinks } from "./places";

const EMPTY: ReadonlyMap<string, LinkState> = new Map();

export function useLinkStates(entries: readonly MediaIndexEntry[]): ReadonlyMap<string, LinkState> {
  const [states, setStates] = useState<ReadonlyMap<string, LinkState>>(EMPTY);

  // 対象のリンクした素材（控えが正しい形のものだけ）。控え（大きさ・更新日時）も鍵に含め、控え直したら状態を引き直す
  const targets = useMemo(() => entries.filter(isLinkedEntry), [entries]);
  const key = targets
    .map((e) => `${e.fileId}\t${e.link!.placeId}\t${e.link!.relPath}\t${e.link!.size}\t${e.link!.mtimeMs}`)
    .join("\n");

  // 呼び出しの状態は対象が変わっても引き継ぐ（対象が変わるたびに重ねて呼ばないため）
  const targetsRef = useRef(targets);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    targetsRef.current = targets;
    if (!isTauri() || targets.length === 0) {
      setStates(EMPTY);
      return;
    }
    const run = async (): Promise<void> => {
      if (inFlightRef.current) {
        // 進行中。終わったあとに 1 回だけ呼び直す
        pendingRef.current = true;
        return;
      }
      inFlightRef.current = true;
      const snapshot = targetsRef.current;
      try {
        const stats = await statLinks(snapshot.map((e) => ({ placeId: e.link!.placeId, relPath: e.link!.relPath })));
        // アンマウント後・待っているあいだに対象が変わった結果は捨てる（呼び直しで取り直す）
        if (!mountedRef.current || snapshot !== targetsRef.current) return;
        const next = new Map<string, LinkState>();
        snapshot.forEach((e, i) => {
          const stat = stats[i];
          if (stat) next.set(e.fileId, linkState(e.link!, stat));
        });
        setStates(next);
      } catch (err) {
        // 取れなかったときは前の状態のまま（一覧の表示は止めない）
        if (mountedRef.current) console.warn("リンクした素材の状態を取れませんでした:", err);
      } finally {
        inFlightRef.current = false;
        if (pendingRef.current && mountedRef.current && isTauri() && targetsRef.current.length > 0) {
          pendingRef.current = false;
          void run();
        } else {
          pendingRef.current = false;
        }
      }
    };
    void run();
    const onFocus = () => void run();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return states;
}
