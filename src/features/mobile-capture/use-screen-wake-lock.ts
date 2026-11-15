// 録音中に画面が自動で消えないようにする（Screen Wake Lock）。
//
// スマホは何も触らないと数十秒〜数分で画面を消す。iOS は画面が見えていないと
// マイク入力が止まることがあるので、録音中だけ画面を点けたままにする。
//
// - 対応していないブラウザでは何もしない（録音そのものは今までどおり動く）
// - ロックはページが隠れると OS が外す。戻ってきたときにまだ録音中なら取り直す
// - 取れなかった（省電力モード等）ときも録音は止めない。黙って諦める

import { useEffect } from "react";

type WakeLockSentinelLike = { release: () => Promise<void> };
type WakeLockLike = { request: (type: "screen") => Promise<WakeLockSentinelLike> };

function getWakeLock(): WakeLockLike | null {
  if (typeof navigator === "undefined") return null;
  const wakeLock = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
  return wakeLock && typeof wakeLock.request === "function" ? wakeLock : null;
}

/** `active` の間だけ画面を点けたままにする。 */
export function useScreenWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const wakeLock = getWakeLock();
    if (!wakeLock) return;

    let cancelled = false;
    let sentinel: WakeLockSentinelLike | null = null;

    const acquire = () => {
      if (document.visibilityState !== "visible") return;
      wakeLock
        .request("screen")
        .then((next) => {
          if (cancelled) {
            void next.release().catch(() => {});
            return;
          }
          sentinel = next;
        })
        .catch(() => {
          // 省電力モードや権限で断られることがある。録音は続ける
        });
    };

    acquire();
    const onVisibility = () => acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [active]);
}
