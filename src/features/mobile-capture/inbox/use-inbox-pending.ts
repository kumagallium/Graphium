// 受信箱の未取り込みアイテムを持ち、届いたら自動で並べ直すフック。
//
// 「実験室で撮って、席に戻ったらもう並んでいる」ための見張り。同期フォルダには
// 変更の通知が無い（クラウドの同期クライアントが外から書く）ので、次の 3 つで数え直す:
//   - 源（接続フォルダ）が変わったとき
//   - ウィンドウに戻ったとき（focus / 表示に戻る）
//   - 表示中は一定間隔（既定 20 秒）
// 画面が隠れている間は数えない（裏で IPC を回し続けない）。
//
// 中身が変わっていない再スキャンでは items の参照を保つ。参照が変わるとタイルが
// サムネイルを読み直すので、何も届いていないのに画像がちらつくのを避ける。

import { useCallback, useEffect, useRef, useState } from "react";
import type { CaptureRef } from "./types";

/** 見張りの間隔の既定値（ミリ秒）。 */
export const INBOX_POLL_INTERVAL_MS = 20_000;

/** 一覧の中身（名前・サイズ・更新日時）が同じか。順序も見る。 */
export function sameCaptureRefs(a: readonly CaptureRef[], b: readonly CaptureRef[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].name !== b[i].name || a[i].bytes !== b[i].bytes || a[i].modifiedAt !== b[i].modifiedAt) {
      return false;
    }
  }
  return true;
}

/**
 * 数え直した一覧を、前の一覧と突き合わせる。全部同じなら前の配列をそのまま返し、
 * 一部だけ変わったときも、変わっていないアイテムは前のオブジェクトを使い回す
 * （届いた 1 枚のために、並んでいる全部のサムネイルを読み直さない）。
 */
export function reconcileCaptureRefs(prev: CaptureRef[], listed: CaptureRef[]): CaptureRef[] {
  if (sameCaptureRefs(prev, listed)) return prev;
  const byName = new Map(prev.map((r) => [r.name, r]));
  return listed.map((r) => {
    const old = byName.get(r.name);
    return old && old.bytes === r.bytes && old.modifiedAt === r.modifiedAt ? old : r;
  });
}

/**
 * 「戻ってきたとき」と「表示中の一定間隔」で fn を呼ぶ。全画面の受信箱と右パネルで共用。
 * fn は最新のものを ref 経由で呼ぶので、呼び出し側は関数の同一性を気にしなくてよい。
 */
export function useAutoRescan(
  fn: () => void,
  enabled: boolean,
  intervalMs: number = INBOX_POLL_INTERVAL_MS,
): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const visible = () => typeof document === "undefined" || document.visibilityState === "visible";
    const run = () => {
      if (visible()) fnRef.current();
    };
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", run);
    const timer = intervalMs > 0 ? window.setInterval(run, intervalMs) : null;
    return () => {
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", run);
      if (timer != null) window.clearInterval(timer);
    };
  }, [enabled, intervalMs]);
}

export type InboxPending = {
  items: CaptureRef[];
  loading: boolean;
  /** いますぐ数え直す（取り込みのあと・更新ボタン）。 */
  refresh: () => Promise<void>;
};

export function useInboxPending(
  source: { listPending(): Promise<CaptureRef[]> } | null,
  intervalMs: number = INBOX_POLL_INTERVAL_MS,
): InboxPending {
  const [items, setItems] = useState<CaptureRef[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    if (!source) {
      setItems((prev) => (prev.length === 0 ? prev : []));
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const listed = await source.listPending();
      if (mine !== seq.current) return;
      setItems((prev) => reconcileCaptureRefs(prev, listed));
    } catch {
      // 読めないときは空にする（件数の印が古い数のまま残らないように）。起動は妨げない
      if (mine === seq.current) setItems((prev) => (prev.length === 0 ? prev : []));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [source]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useAutoRescan(() => void refresh(), source != null, intervalMs);

  return { items, loading, refresh };
}
