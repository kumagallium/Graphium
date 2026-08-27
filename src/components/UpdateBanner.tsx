// アプリ更新通知バナー
// updater.ts が CustomEvent で通知 → このコンポーネントがバナーを表示
//
// 通知は 2 種類ある:
//   graphium-update-available … 自動更新できる（インストールボタンを出す）
//   graphium-update-manual    … 新版はあるが自動更新のチェックが通らなかった
//                               （企業プロキシ等。手動ダウンロードに案内する）

import { useCallback, useEffect, useState } from "react";
import { useT } from "../i18n";
import { openExternalUrl } from "../lib/external-link";
import {
  checkForUpdates,
  toUpdaterErrorInfo,
  MANUAL_DOWNLOAD_URL,
  type ManualUpdateDetail,
  type UpdateAvailableDetail,
  type UpdateProgress,
  type UpdaterErrorInfo,
} from "../lib/updater";

export function UpdateBanner() {
  const t = useT();
  const [update, setUpdate] = useState<UpdateAvailableDetail | null>(null);
  const [manual, setManual] = useState<ManualUpdateDetail | null>(null);
  const [installing, setInstalling] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [error, setError] = useState<UpdaterErrorInfo | null>(null);
  const [showErrorDetail, setShowErrorDetail] = useState(false);

  useEffect(() => {
    const onAvailable = (e: Event) => {
      const detail = (e as CustomEvent<UpdateAvailableDetail>).detail;
      setUpdate(detail);
      // 自動更新が使えるようになったら手動案内は引っ込める
      setManual(null);
    };
    const onManual = (e: Event) => {
      const detail = (e as CustomEvent<ManualUpdateDetail>).detail;
      setManual(detail);
    };
    window.addEventListener("graphium-update-available", onAvailable);
    window.addEventListener("graphium-update-manual", onManual);
    return () => {
      window.removeEventListener("graphium-update-available", onAvailable);
      window.removeEventListener("graphium-update-manual", onManual);
    };
  }, []);

  const handleInstall = useCallback(async () => {
    if (!update) return;
    setInstalling(true);
    setError(null);
    setShowErrorDetail(false);
    try {
      await update.install((p) => setProgress(p));
    } catch (e) {
      console.error("[updater] Install failed:", e);
      setError(toUpdaterErrorInfo(e));
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
    setError(null);
    try {
      const result = await checkForUpdates();
      if (result.status === "up-to-date") {
        setUpdate(null);
        setManual(null);
      }
    } finally {
      setRechecking(false);
    }
  }, []);

  if (!update && !manual) return null;

  // インストール中に出た失敗を優先し、無ければ手動案内に付いてきた理由を出す
  const shownError = error ?? manual?.error ?? null;
  const version = update?.version ?? manual?.version ?? "";

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

  const linkButtonStyle = {
    padding: 0,
    fontSize: 12,
    border: "none",
    background: "transparent",
    color: "#a33",
    textDecoration: "underline",
    cursor: "pointer",
  } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
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
        <span>
          {update
            ? t("updater.available", { version })
            : t("updater.manualAvailable", { version })}
        </span>
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
        {update && (
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
        )}
        {shownError && (
          <>
            <span style={{ color: "#a33", fontSize: 12 }}>
              {t(shownError.key)}
            </span>
            {shownError.offerManualDownload && (
              <button
                onClick={() => void openExternalUrl(MANUAL_DOWNLOAD_URL)}
                style={linkButtonStyle}
              >
                {t("updater.manualDownload")}
              </button>
            )}
            <button
              onClick={() => setShowErrorDetail((v) => !v)}
              style={linkButtonStyle}
            >
              {showErrorDetail
                ? t("updater.errorDetailHide")
                : t("updater.errorDetailShow")}
            </button>
          </>
        )}
      </div>
      {shownError && showErrorDetail && (
        <div
          style={{
            padding: "6px 16px",
            background: "rgba(170, 51, 51, 0.06)",
            borderBottom: "1px solid #c5ddc8",
            fontFamily: "monospace",
            fontSize: 11,
            color: "#a33",
            userSelect: "text",
            wordBreak: "break-all",
            overflowWrap: "break-word",
          }}
        >
          {shownError.detail && <div>{shownError.detail}</div>}
          <div>{shownError.raw}</div>
        </div>
      )}
    </div>
  );
}
