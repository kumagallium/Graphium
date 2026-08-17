// バックエンド停止バナー（デスクトップ版）
//
// sidecar（AI バックエンド）が「動いていたはずなのに、こちらの操作なしに終了した」
// ときに画面上部へ出す。更新バナー（UpdateBanner）と同じ位置・同じ作りで、色だけ
// 警告系にしている。
//
// 背景（2026-08-17）: sidecar が無音で死んだあとも UI は「AI 接続済み」のままで、
// ユーザーは次に AI を使ったときの "Load failed" で初めて気づいた。しかも設定画面の
// 奥にある「バックエンドを再起動」まで辿り着かないと直せなかった。停止した事実を
// 更新通知と同じ目立ち方で見せ、その場の 1 クリックで再起動できるようにする。
//
// 自動再起動はしない。死因が特定できていない状況で勝手に立ち上げ直すと、失敗を
// 繰り返しても気づけないし、原因の痕跡（ログ）も流れてしまう。「気づかせて、
// 1 クリックで直せる」に留める。

import { useCallback, useEffect, useState } from "react";
import { useT } from "../i18n";
import {
  getRecentSidecarLog,
  getSidecarState,
  restartSidecar,
  subscribeSidecarState,
  type SidecarState,
} from "../lib/sidecar";

/** バナーを出すべき状態か。sidecar.ts の unexpectedExit だけを見る（他の failed は設定画面側の領分） */
export function shouldShowBackendDownBanner(state: Pick<SidecarState, "status" | "unexpectedExit">): boolean {
  return state.status === "failed" && state.unexpectedExit;
}

export function BackendDownBanner() {
  const t = useT();
  const [state, setState] = useState<SidecarState>(() => getSidecarState());
  const [restarting, setRestarting] = useState(false);
  const [restartFailed, setRestartFailed] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => subscribeSidecarState(setState), []);

  const handleRestart = useCallback(async () => {
    setRestarting(true);
    setRestartFailed(false);
    try {
      const ok = await restartSidecar();
      if (!ok) {
        setRestartFailed(true);
        setLog(getRecentSidecarLog());
        setShowLog(true);
      }
    } catch {
      setRestartFailed(true);
      setLog(getRecentSidecarLog());
      setShowLog(true);
    } finally {
      setRestarting(false);
    }
  }, []);

  const handleToggleLog = useCallback(() => {
    setShowLog((v) => {
      if (!v) setLog(getRecentSidecarLog());
      return !v;
    });
  }, []);

  // 再起動が成功すると sidecar.ts が ready + unexpectedExit=false にするので自然に消える。
  // 再起動が失敗した場合は failed のままだが unexpectedExit も true のままなので出続ける
  // （ユーザーがもう一度押すか、設定画面から対処できる）。
  if (!shouldShowBackendDownBanner(state)) return null;

  return (
    <div
      role="alert"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "6px 16px",
        background: "#fdf2ee",
        borderBottom: "1px solid #ecc5b8",
        fontSize: 13,
        color: "#7a3b26",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
        <span>
          {restartFailed ? t("settings.health.restartFailed") : t("backendDown.message")}
          {state.lastError && (
            <span style={{ marginLeft: 8, opacity: 0.75, fontSize: 12 }}>
              {t("backendDown.detail", { info: state.lastError })}
            </span>
          )}
        </span>
        <button
          onClick={handleToggleLog}
          disabled={restarting}
          style={{
            padding: "3px 12px",
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 4,
            border: "1px solid #b0563a",
            background: "transparent",
            color: "#7a3b26",
            cursor: restarting ? "default" : "pointer",
          }}
        >
          {showLog ? t("settings.health.hideLog") : t("settings.health.showLog")}
        </button>
        <button
          onClick={handleRestart}
          disabled={restarting}
          style={{
            padding: "3px 12px",
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 4,
            border: "1px solid #b0563a",
            background: restarting ? "#ecc5b8" : "#b0563a",
            color: "#fff",
            cursor: restarting ? "default" : "pointer",
          }}
        >
          {restarting ? t("settings.health.restarting") : t("settings.health.restart")}
        </button>
      </div>
      {showLog && (
        <pre
          style={{
            margin: 0,
            maxHeight: 160,
            overflow: "auto",
            padding: "6px 8px",
            fontSize: 11,
            lineHeight: 1.4,
            background: "rgba(0,0,0,0.04)",
            borderRadius: 4,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {log.length > 0 ? log.join("\n") : "(no log)"}
        </pre>
      )}
    </div>
  );
}
