// 終了時に録音中なら止めて素材に登録する（アプリを閉じる流れ lib/flush-on-exit.ts から呼ぶ）。
// 失敗しても終了は止めない。上限つきで諦める。

import { isTauri } from "../../lib/platform";
import { registerRecording } from "./register-recording";
import * as store from "./store";

const EXIT_RECORDING_TIMEOUT_MS = 5000;

async function flush(): Promise<void> {
  if (store.getState().phase === "recording") await store.stop();
  // 手動の止めるが進行中なら、終わる（idle / error）まで待つ
  if (store.getState().phase === "stopping") {
    await new Promise<void>((resolve) => {
      const unsub = store.subscribe(() => {
        if (store.getState().phase !== "stopping") {
          unsub();
          resolve();
        }
      });
    });
  }
  const result = store.getState().result;
  if (!result) return;
  await registerRecording(result);
  store.clearResult();
}

export async function flushMeetingRecordingOnExit(): Promise<void> {
  if (!isTauri()) return;
  if (store.getState().phase !== "recording" && store.getState().phase !== "stopping") return;
  try {
    await Promise.race([
      flush(),
      new Promise<void>((resolve) => setTimeout(resolve, EXIT_RECORDING_TIMEOUT_MS)),
    ]);
  } catch (e) {
    console.warn("[exit] 会議録音の保存に失敗:", e);
  }
}
