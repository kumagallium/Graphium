// MCP の知らせを見張り、届いたら順に処理するフック（MCP → アプリ）。
// use-web-clip-inbox と同じ形: setTimeout の再帰・重複実行の防止・focus で即時・アンマウントで停止。
// 画面が隠れていても見張る（外の AI の作業中は Graphium が裏にいることが多い）。
// 加えて、ナレッジのページをエディタへ渡す入口（lib/external-changes）から「いま知らせをさらう」と
// 頼まれたときにも同じ処理を走らせる（反映前に古いキャッシュで開いてしまうのを防ぐ）

import { useEffect, useRef } from "react";
import { getExternalChangeDrainer, setExternalChangeDrainer } from "../../lib/external-changes";
import { asMaintenanceStorage, type MaintenanceStorageLike } from "../knowledge-maintenance/types";
import type { McpLiveNotice } from "./format";
import { drainMcpNotices, type McpNoticeStorage } from "./notices";

/** 知らせを確かめる間隔 */
export const MCP_NOTICE_POLL_MS = 10_000;

// 実行中の 1 本。effect をまたいで効かせる（保存先が替わって effect が作り直されたとき、
// 古い実行の処理中に新しい実行が同じ知らせを二重に処理しない。実行中なら同じ Promise を返す）
let inflight: Promise<void> | null = null;

/** 知らせを 1 回さらう。実行中ならその実行を待つ（重複して走らせない） */
export function drainOnce(
  storage: McpNoticeStorage,
  handle: (notice: McpLiveNotice) => Promise<void>,
): Promise<void> {
  if (inflight) return inflight;
  const run: Promise<void> = drainMcpNotices(storage, handle).then(
    () => {
      if (inflight === run) inflight = null;
    },
    (e) => {
      if (inflight === run) inflight = null;
      throw e;
    },
  );
  inflight = run;
  return run;
}

/** テスト用: 実行中の記録を捨てる */
export function resetMcpNoticeInflightForTest(): void {
  inflight = null;
}

export type McpNoticesOptions = {
  /** false の間は見張らない（保存先の準備ができる前など） */
  enabled: boolean;
  provider: MaintenanceStorageLike | null | undefined;
  /** 1 件の知らせの処理。例外を投げると知らせは残り、次回に再試行される（毎レンダーで差し替えてよい） */
  handle: (notice: McpLiveNotice) => Promise<void>;
};

export function useMcpNotices(options: McpNoticesOptions): void {
  const optsRef = useRef(options);
  optsRef.current = options;
  const { enabled, provider } = options;

  useEffect(() => {
    if (!enabled) return;
    const storage = asMaintenanceStorage(provider);
    // 非対応の保存先では何もしない
    if (!storage) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const run = () => drainOnce(storage, (n) => optsRef.current.handle(n));
    const drainer = () => run();
    setExternalChangeDrainer(drainer);

    let ticking = false;
    const tick = async () => {
      if (stopped || ticking) return;
      ticking = true;
      try {
        await run();
      } catch (e) {
        console.warn("[mcp-live] 知らせの確認に失敗:", e);
      } finally {
        ticking = false;
      }
      if (!stopped) timer = setTimeout(tick, MCP_NOTICE_POLL_MS);
    };

    // 前面に戻ったときはすぐ確かめる
    const onFocus = () => {
      if (timer) clearTimeout(timer);
      void tick();
    };
    window.addEventListener("focus", onFocus);
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      // 自分が登録した口だけ外す（新しい effect が先に登録していれば残す）
      if (getExternalChangeDrainer() === drainer) setExternalChangeDrainer(null);
    };
  }, [enabled, provider]);
}
