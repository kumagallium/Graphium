// 会議録音: ストアを読む hook

import { useEffect, useSyncExternalStore } from "react";
import * as store from "./store";

export function useMeetingRecorder() {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return {
    ...state,
    /** 「会議を録る」押下。確認ダイアログを開く */
    open: store.openConfirm,
    cancel: store.cancelConfirm,
    setCaptureSystem: store.setCaptureSystem,
    /** ダイアログの「始める」。permission を確認してから録音を開始する */
    start: () => store.start(),
    stop: () => store.stop(),
    dismissError: store.dismissError,
  };
}

/**
 * 素材ごとの、直近の文字起こしジョブの終わり方だけを読む。
 * 録音中の音量や発言では値が変わらないので、アプリ本体から呼んでも描き直しが増えない
 */
export function useTranscribeJobs(): Readonly<Record<string, "done" | "failed" | "cancelled">> {
  const read = () => store.getState().lastJobByFile;
  return useSyncExternalStore(store.subscribe, read, read);
}

/** Mount 側で 1 度だけ呼ぶ: イベント購読と、録音中の復元 */
export function useMeetingRecorderBoot(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    void store.attachListeners();
    void store.syncStatus();
  }, [enabled]);
}
