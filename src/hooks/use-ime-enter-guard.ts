// IME composition を ref で追跡し、keydown が「変換確定の Enter（等）」かを
// 判定するフック。判定ロジックの背景は src/lib/ime-enter.ts を参照。
//
// 使い方:
//   const { compositionHandlers, isImeKey } = useImeEnterGuard();
//   <input
//     {...compositionHandlers}   // onCompositionStart/End を必ず紐付ける
//     onKeyDown={(e) => {
//       if (e.key === "Enter" && !isImeKey(e)) submit();
//     }}
//   />
import { useCallback, useMemo, useRef } from "react";
import { isImeKeyEvent } from "../lib/ime-enter";

type GuardableKeyEvent = {
  keyCode: number;
  nativeEvent: { isComposing: boolean };
};

export function useImeEnterGuard() {
  const composingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);

  const onCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);
  const onCompositionEnd = useCallback(() => {
    composingRef.current = false;
    lastCompositionEndAtRef.current = Date.now();
  }, []);

  const isImeKey = useCallback(
    (e: GuardableKeyEvent) =>
      isImeKeyEvent({
        composingNow: composingRef.current,
        isComposing: e.nativeEvent.isComposing,
        keyCode: e.keyCode,
        msSinceCompositionEnd: Date.now() - lastCompositionEndAtRef.current,
      }),
    [],
  );

  const compositionHandlers = useMemo(
    () => ({ onCompositionStart, onCompositionEnd }),
    [onCompositionStart, onCompositionEnd],
  );

  return { compositionHandlers, isImeKey };
}
