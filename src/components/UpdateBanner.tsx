// アプリ更新通知バナー
// updater.ts が CustomEvent で通知 → このコンポーネントがバナーを表示

import { useCallback, useEffect, useState } from "react";
import { useT } from "../i18n";
import {
  checkForUpdates,
  type UpdateAvailableDetail,
  type UpdateProgress,
} from "../lib/updater";

export function UpdateBanner() {
  const t = useT();
  const [update, setUpdate] = useState<UpdateAvailableDetail | null>(null);
  const [installing, setInstalling] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
    try {
      await update.install((p) => setProgress(p));
    } catch (e) {
      console.error("[updater] Install failed:", e);
      setError(e instanceof Error ? e.message : String(e));
      setInstalling(false);
      setProgress(null);
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

  // installing 中のボタンラベルは進捗の有無・種類で出し分ける
  let installLabel = t("updater.install");
  if (installing) {
    if (progress?.phase === "downloading" && progress.total) {
      const percent = Math.round((progress.downloaded / progress.total) * 100);
      installLabel = t("updater.downloading", { percent: String(percent) });
    } else if (progress?.phase === "downloading") {
      const mb = (progress.downloaded / 1024 / 1024).toFixed(1);
      installLabel = t("updater.downloadingBytes", { mb });
    } else if (progress?.phase === "installing") {
      installLabel = t("updater.installingNow");
    } else {
      installLabel = t("updater.installing");
    }
  }

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
        {installLabel}
      </button>
      {error && (
        <span style={{ color: "#a33", fontSize: 12 }}>
          {t("updater.error", { message: error })}
        </span>
      )}
    </div>
  );
}
