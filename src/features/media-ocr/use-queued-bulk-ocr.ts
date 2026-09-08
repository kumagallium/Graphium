// 一括 OCR を後追いで直列に回すための薄い hook
//
// 投入口は取り込みを先に終わらせ、画像の文字読み取りは裏で追いかける。取り込み中に
// 次の取り込みが来ることもあるので、対象は 1 本のキューに積み、実行中フラグで
// 同時に 2 本走らせない（media-index への書き戻し競合を避けるのは runBulkOcr と同じ理由）。
// 進行状況は素材ギャラリーの一括読み取りと同じ OcrToast で見せる。

import { useCallback, useRef, useState } from "react";
import { runBulkOcr, type BulkOcrTarget } from "./bulk-ocr";
import type { OcrToastState } from "./OcrToast";

export function useQueuedBulkOcr() {
  const [toast, setToast] = useState<OcrToastState>(null);
  const queueRef = useRef<BulkOcrTarget[]>([]);
  const runningRef = useRef(false);

  const runNext = useCallback(async () => {
    if (runningRef.current) return; // 既に 1 本走っている。積んだだけで戻る（finally 側が続けて拾う）
    const targets = queueRef.current.splice(0, queueRef.current.length);
    if (targets.length === 0) return;
    runningRef.current = true;
    try {
      await runBulkOcr(targets, {
        onProgress: (p) => setToast({ running: p.running, chars: p.chars, empty: p.empty, failed: p.failed }),
      });
    } finally {
      runningRef.current = false;
      // 実行中にさらに取り込みが来てキューに積まれていたら、続けて次のバッチを回す
      if (queueRef.current.length > 0) void runNext();
    }
  }, []);

  const enqueue = useCallback(
    (targets: BulkOcrTarget[]) => {
      if (targets.length === 0) return;
      queueRef.current.push(...targets);
      void runNext();
    },
    [runNext],
  );

  return { toast, enqueue };
}
