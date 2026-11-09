// アプリ側の記録の書き手。AI チャットの回答が引用したページを appdata に積む。
// 共通の形は usage-log.ts。ここは「どのプロバイダに・順番に・失敗しても会話を壊さずに」書く担当。

import type { StorageProvider } from "../../lib/storage/types";
import {
  appendUsageEvents,
  buildUsageEvents,
  newUsageSessionId,
  usageKey,
} from "./usage-log";

type AppDataProvider = Pick<StorageProvider, "readAppData" | "writeAppData">;

export type AppUsageRecorder = {
  /** 1 回の回答が引用した ref を記録する。待たなくてよい（失敗しても投げない） */
  recordCitations(refs: readonly string[], opts?: { group?: string; at?: Date }): Promise<void>;
};

/**
 * 書き手を作る。セッション ID はこの書き手ごとに 1 つ（＝ページの読み込みごと）。
 * 書き込みは 1 本の列に並べ、同じファイルの読み書きが重ならないようにする。
 */
export function createAppUsageRecorder(
  getProvider: () => AppDataProvider | null | undefined,
  session: string = newUsageSessionId(),
): AppUsageRecorder {
  let queue: Promise<void> = Promise.resolve();
  return {
    recordCitations(refs, opts) {
      if (refs.length === 0) return Promise.resolve();
      const at = opts?.at ?? new Date();
      const group = opts?.group ?? globalThis.crypto.randomUUID();
      const run = async () => {
        const provider = getProvider();
        // 記録の置き場所を持たないプロバイダ（Google Drive など）では何もしない
        if (!provider?.readAppData || !provider.writeAppData) return;
        const key = usageKey(at, "app", session);
        const existing = await provider.readAppData(key);
        const next = appendUsageEvents(existing, buildUsageEvents(refs, "cite", group, at), {
          writer: "app",
          session,
        });
        await provider.writeAppData(key, next);
      };
      queue = queue.then(run).catch((err) => {
        // 記録に失敗しても会話は続ける（数が 1 回分欠けるだけ）
        console.warn("[ai-usage] 記録に失敗しました", err);
      });
      return queue;
    },
  };
}
