// sidecar の受け取り待ちを見張り、届いたクリップを順に振り分けるフック。
//
// 拡張機能からのクリップは利用者がブラウザにいる間に届く（Graphium は裏にいる）ので、
// 画面が隠れていても見張る。相手はローカルの sidecar なので数秒おきでも負担は小さい。
// sidecar の無い環境（Pages 版など）では間隔を延ばして空振りを減らす。

import { useEffect, useRef } from "react";
import { ackClip, fetchClipInbox } from "./api";
import { processClip, type ClipRunMemory, type ProcessClipDeps, type ProcessClipResult } from "./process-clip";
import type { WebClip } from "./clip-note";

/** 届くのを待つ間隔 */
export const CLIP_POLL_MS = 4000;
/** sidecar が見つからないときの間隔（起動途中・Pages 版） */
export const CLIP_POLL_IDLE_MS = 60_000;

export type WebClipInboxOptions = {
  /** false の間は見張らない（保存先の準備ができる前など） */
  enabled: boolean;
  /** クリップのまとめ先フォルダ */
  folder: string;
  /** 振り分けの依存（呼ぶたびに最新を読めるよう、毎レンダーで差し替えてよい） */
  deps: ProcessClipDeps;
  /**
   * 開いているノートへの挿入がまだ終わっていないか。終わるまで次のクリップは待つ
   * （エディタへの挿入依頼は 1 件ずつしか持てない）
   */
  isBusy: () => boolean;
  /** 1 件振り分けたとき（知らせの表示用） */
  onProcessed?: (clip: WebClip, result: ProcessClipResult) => void;
  /** 振り分けに失敗したとき。クリップは受け取り待ちに残り、次の見張りで再試行される */
  onError?: (clip: WebClip, error: unknown) => void;
};

/**
 * 受け取り待ちを 1 回さらう。テストから直接呼べるようフックの外に出してある。
 * 戻り値は sidecar が見つかったか（false なら呼び出し側が間隔を延ばす）。
 */
export async function drainClipInbox(
  getOpts: () => Omit<WebClipInboxOptions, "enabled">,
  io: { fetchInbox: typeof fetchClipInbox; ack: typeof ackClip } = { fetchInbox: fetchClipInbox, ack: ackClip },
): Promise<boolean> {
  const clips = await io.fetchInbox();
  if (clips === null) return false;
  const run: ClipRunMemory = new Map();
  for (const clip of clips) {
    // 1 件ごとに読み直す（前の件の書き込みで再レンダーされていれば、新しい索引を見る）
    const opts = getOpts();
    if (opts.isBusy()) break;
    let result: ProcessClipResult;
    try {
      result = await processClip(clip, opts.folder, opts.deps, run);
    } catch (error) {
      opts.onError?.(clip, error);
      // 1 件の失敗で残りを止めない。失敗した分は受け取り待ちに残る
      continue;
    }
    // メモ・ノートができてから消す。消すのに失敗すると次回もう一度振り分けて二重になるが、
    // 落とすよりはよい
    try {
      await io.ack(clip.id);
    } catch {
      // 次の見張りで消し直す
    }
    opts.onProcessed?.(clip, result);
  }
  return true;
}

export function useWebClipInbox(options: WebClipInboxOptions): void {
  const optsRef = useRef(options);
  optsRef.current = options;
  const { enabled } = options;

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;

    const tick = async () => {
      if (stopped || running) return;
      running = true;
      let found = true;
      try {
        found = await drainClipInbox(() => optsRef.current);
      } catch (e) {
        console.warn("[web-clip] 受け取り待ちの確認に失敗:", e);
      } finally {
        running = false;
      }
      if (!stopped) timer = setTimeout(tick, found ? CLIP_POLL_MS : CLIP_POLL_IDLE_MS);
    };

    // 前面に戻ったときはすぐ確かめる（待たせない）
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
    };
  }, [enabled]);
}
