// サイドバーのナレッジ節に出す、バックエンド（sidecar）の起動状況表示。
//
// 背景（2026-08-26）: デスクトップ版の起動直後は到達性チェックがまだ終わって
// おらず、サイドバーが「バックエンド無し = web 版」と同じ扱いで AiUpgradeNotice
// （「デスクトップ版を入手」）を数秒表示していた。デスクトップアプリの中で
// デスクトップ版の入手を勧める、という矛盾した状態になる。
//
// 判定が付くまでは「起動中」であることだけを示し、付いてから web / desktop の
// それぞれ正しい案内に差し替える。起動を待ってウィンドウ全体を止めることはしない
// ── Graphium は AI が無くてもエディタは完全に使えるので、AI を使わない人まで
// 毎回待たせる作りにはしない。

import { useCallback, useState } from "react";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { useT } from "../i18n";
import { restartSidecar } from "../lib/sidecar";

/** 到達性チェック中（sidecar の起動待ち）。 */
export function BackendStartingNotice() {
  const t = useT();
  return (
    <div className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
      <Loader2 size={12} className="shrink-0 animate-spin" aria-hidden />
      <span>{t("sidebar.backendStarting")}</span>
    </div>
  );
}

/**
 * デスクトップ版でバックエンドに到達できなかったとき。
 *
 * 再起動が成功すると sidecar の状態が ready に遷移し、note-app 側の購読が
 * AI 到達性を再判定する。そのためここでは成功時に何も通知しない。
 */
export function BackendUnavailableNotice() {
  const t = useT();
  const [restarting, setRestarting] = useState(false);

  const handleRestart = useCallback(async () => {
    setRestarting(true);
    try {
      await restartSidecar();
    } catch {
      // 失敗しても状態は sidecar 側が failed のまま保つ。詳細な診断（ログの
      // コピー等）は設定 > ヘルスと AI パネルの AiBackendDiagnostic の領分。
    } finally {
      setRestarting(false);
    }
  }, []);

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
      <div className="flex items-start gap-1.5">
        <AlertCircle size={12} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-xs text-muted-foreground leading-relaxed">{t("sidebar.backendUnavailable")}</p>
      </div>
      <button
        onClick={handleRestart}
        disabled={restarting}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border bg-background text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50"
      >
        <RefreshCw size={11} className={restarting ? "animate-spin" : ""} aria-hidden />
        {restarting ? t("aiChat.restarting") : t("aiChat.restartBackend")}
      </button>
    </div>
  );
}
