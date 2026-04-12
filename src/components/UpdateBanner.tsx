// アプリ更新通知バナー
// updater.ts が CustomEvent で通知 → このコンポーネントがバナーを表示

import { useCallback, useEffect, useState } from "react";
import { useT } from "../i18n";
import type { UpdateAvailableDetail } from "../lib/updater";

export function UpdateBanner() {
  const t = useT();
  const [update, setUpdate] = useState<UpdateAvailableDetail | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<UpdateAvailableDetail>).detail;
      setUpdate(detail);
    };
    window.addEventListener("graphium-update-available", handler);
    return () => window.removeEventListener("graphium-update-available", handler);
  }, []);

  const handleInstall = useCallback(async () => {
    if (!update) return;
    setInstalling(true);
    try {
      await update.install();
    } catch (e) {
      console.error("[updater] Install failed:", e);
      setInstalling(false);
    }
  }, [update]);

  if (!update) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: "6px 16px",
        background: "#edf5ee",
        borderBottom: "1px solid #c5ddc8",
        fontSize: 13,
        color: "#2d5a32",
      }}
    >
      <span>{t("updater.available", { version: update.version })}</span>
      <button
        onClick={handleInstall}
        disabled={installing}
        style={{
          padding: "3px 12px",
          fontSize: 12,
          fontWeight: 600,
          borderRadius: 4,
          border: "1px solid #4B7A52",
          background: installing ? "#c5ddc8" : "#4B7A52",
          color: "#fff",
          cursor: installing ? "default" : "pointer",
        }}
      >
        {installing ? t("updater.installing") : t("updater.install")}
      </button>
    </div>
  );
}
