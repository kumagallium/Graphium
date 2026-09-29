// 拡大縮小の「気づいてもらう」表示をアプリのルートに置く層。
//
// - 倍率を変えたとき（キー・ホイール・メニュー）の短い表示（ZoomToast）
// - 画面が狭い環境でだけ、一度だけ出す案内（NarrowScreenZoomHint）
//
// どの画面（ノート・一覧・ナレッジ・素材など）でも出るよう、note-app の外（main.tsx）に置く。
// 倍率の変更はデスクトップ（Tauri）だけで起きる。ブラウザ版は案内だけを出す。

import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "../../lib/platform";
import { getUiZoom, onUiZoomChanged, setUiZoom } from "../../lib/ui-zoom";
import { NarrowScreenZoomHint } from "./NarrowScreenZoomHint";
import { ZoomToast } from "./ZoomToast";
import {
  WELCOME_DISMISSED_EVENT,
  WELCOME_SHOWN_KEY,
  ZOOM_HINT_APPLY_LEVEL,
  ZOOM_HINT_DELAY_MS,
  ZOOM_HINT_DISMISSED_KEY,
  ZOOM_TOAST_MS,
  hasOpenModal,
  markZoomHintDismissed,
  readStorageFlag,
  shouldShowZoomHint,
  shouldShowZoomToast,
} from "./notice";

export function UiZoomOverlays() {
  const isDesktop = isTauri();
  const [toast, setToast] = useState<{ level: number } | null>(null);
  const [hintVisible, setHintVisible] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 案内を閉じた後は、判定が走り直っても出さない（localStorage が使えない環境でも）
  const hintClosed = useRef(false);

  const closeHint = useCallback(() => {
    hintClosed.current = true;
    markZoomHintDismissed();
    setHintVisible(false);
  }, []);

  // 倍率の変更: トースト + 案内を閉じる（すでに変えた人には要らない）
  useEffect(() => {
    return onUiZoomChanged(({ level, source, changed }) => {
      // 端で動かなかったとき（changed: false）は現在の倍率を見せるだけ。案内は閉じない
      if (changed !== false) closeHint();
      if (!shouldShowZoomToast(source)) return;
      setToast({ level });
      // 続けて変えたら時間を延ばして数字を更新する
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), ZOOM_TOAST_MS);
    });
  }, [closeHint]);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  // 案内: アプリが落ち着いてから判定する。初回はようこそを閉じた後に出す
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const evaluate = async () => {
      if (cancelled || hintClosed.current) return;
      // モーダルが開いている間は出さない（閉じるまで待つ）
      if (hasOpenModal(document)) {
        schedule();
        return;
      }
      const info = isDesktop ? await getUiZoom() : null;
      if (cancelled || hintClosed.current) return;
      const show = shouldShowZoomHint({
        innerWidth: window.innerWidth,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        dismissed: readStorageFlag(ZOOM_HINT_DISMISSED_KEY),
        welcomeShown: readStorageFlag(WELCOME_SHOWN_KEY),
        isDesktop,
        level: info?.level ?? null,
      });
      if (show) setHintVisible(true);
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void evaluate(), ZOOM_HINT_DELAY_MS);
    };

    schedule();
    // ようこそダイアログを閉じたら、そこから改めて待って判定する
    window.addEventListener(WELCOME_DISMISSED_EVENT, schedule);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener(WELCOME_DISMISSED_EVENT, schedule);
    };
  }, [isDesktop]);

  return (
    <>
      {hintVisible && (
        <NarrowScreenZoomHint
          isDesktop={isDesktop}
          onDismiss={closeHint}
          onApply={
            isDesktop
              ? () => {
                  // 変更のイベント（source: hint）でも案内は閉じるが、押した時点で確実に閉じる
                  closeHint();
                  void setUiZoom(ZOOM_HINT_APPLY_LEVEL, "hint");
                }
              : undefined
          }
        />
      )}
      <ZoomToast level={toast?.level ?? 1} visible={toast !== null} />
    </>
  );
}
