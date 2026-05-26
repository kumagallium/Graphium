// 聴牌（tenpai）hint の dismiss 状態を localStorage で管理する hook（2026-05-23）。
//
// hint 本体は永続化しない（atom 状態から都度生成）。
// dismiss された hint だけを cooldown 期限付きで保存し、期限切れたら自動的に復活させる。

import { useCallback, useEffect, useState } from "react";
import {
  TENPAI_DEFAULT_COOLDOWN_DAYS,
  TENPAI_DISMISSED_STORAGE_KEY,
  type TenpaiDismissal,
} from "./tenpai-types.js";

/** localStorage から dismiss 一覧を読み込み、期限切れを除外 */
function loadDismissals(): TenpaiDismissal[] {
  try {
    const raw = localStorage.getItem(TENPAI_DISMISSED_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = new Date().toISOString();
    return parsed.filter(
      (x): x is TenpaiDismissal =>
        typeof x === "object" &&
        x !== null &&
        typeof (x as TenpaiDismissal).id === "string" &&
        typeof (x as TenpaiDismissal).dismissedUntil === "string" &&
        (x as TenpaiDismissal).dismissedUntil > now,
    );
  } catch {
    return [];
  }
}

function saveDismissals(items: TenpaiDismissal[]): void {
  try {
    localStorage.setItem(TENPAI_DISMISSED_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // localStorage が一時的に書けない場合は無視（quota 超過など）
  }
}

/** dismiss された hint id の集合と、dismiss / clear の操作を返す hook */
export function useTenpaiDismissals(): {
  isDismissed: (id: string) => boolean;
  dismiss: (id: string, cooldownDays?: number) => void;
  clearAll: () => void;
} {
  const [dismissals, setDismissals] = useState<TenpaiDismissal[]>(() => loadDismissals());

  // 別タブで dismiss されたケースの追従（storage event）
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === TENPAI_DISMISSED_STORAGE_KEY) {
        setDismissals(loadDismissals());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const isDismissed = useCallback(
    (id: string) => dismissals.some((d) => d.id === id),
    [dismissals],
  );

  const dismiss = useCallback(
    (id: string, cooldownDays: number = TENPAI_DEFAULT_COOLDOWN_DAYS) => {
      const until = new Date(Date.now() + cooldownDays * 24 * 60 * 60 * 1000).toISOString();
      setDismissals((prev) => {
        const filtered = prev.filter((d) => d.id !== id);
        const next = [...filtered, { id, dismissedUntil: until }];
        saveDismissals(next);
        return next;
      });
    },
    [],
  );

  const clearAll = useCallback(() => {
    setDismissals([]);
    saveDismissals([]);
  }, []);

  return { isDismissed, dismiss, clearAll };
}
