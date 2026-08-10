// アプリ更新通知バナー
// updater.ts が CustomEvent で通知 → このコンポーネントがバナーを表示

import { useCallback, useEffect, useState } from "react";
import { useT } from "../i18n";
import { checkForUpdates, type UpdateAvailableDetail } from "../lib/updater";

export function UpdateBanner() {
  const t = useT();
  const [update, setUpdate] = useState<UpdateAvailableDetail | null>(null);
  const [installing, setInstalling] = useState(false);
  const [rechecking, setRechecking] = useState(false);

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

  // バナーはチェック時点の結果を保持し続けるため、表示中に新しいリリースが
  // 出ると古いバージョンを案内し続ける。ここから再チェックして取り直せるようにする。
  // 更新が見つかれば updater.ts が同じ CustomEvent を再発火し、上の handler が
  // バナーの内容を最新に差し替える。最新版に追いついていればバナーを閉じる。
  const handleRecheck = useCallback(async () => {
    setRechecking(true);
    try {
      const result = await checkForUpdates();
      if (result.status === "up-to-date") setUpdate(null);
    } finally {
      setRechecking(false);
    }
  }, []);

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
        onClick={handleRecheck}
        disabled={rechecking || installing}
        style={{
          padding: "3px 12px",
          fontSize: 12,
          fontWeight: 600,
          borderRadius: 4,
          border: "1px solid #4B7A52",
          background: "transparent",
          color: "#2d5a32",
          cursor: rechecking || installing ? "default" : "pointer",
          opacity: rechecking ? 0.6 : 1,
        }}
      >
        {rechecking
          ? t("settings.about.checking")
          : t("settings.about.checkNow")}
      </button>
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
