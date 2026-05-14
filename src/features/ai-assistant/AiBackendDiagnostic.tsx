// AI バックエンド (sidecar) が起動できないときに表示される診断バナー。
// Tauri 環境では再起動ボタンと直近ログ・エラー詳細を出し、原因究明と自己復旧を助ける。

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ChevronDown, ChevronRight, Copy, RefreshCw } from "lucide-react";
import { useT } from "../../i18n";
import { isTauri } from "../../lib/platform";
import {
  getRecentSidecarLog,
  getSidecarState,
  restartSidecar,
  subscribeSidecarState,
  type SidecarState,
} from "../../lib/sidecar";
import { fetchModels } from "./api";

type Props = {
  /** sidecar 再起動が成功し、モデルチェックまで通った場合に呼ばれる */
  onRecovered?: (next: "connected" | "no-models") => void;
};

export function AiBackendDiagnostic({ onRecovered }: Props) {
  const t = useT();
  const tauri = isTauri();
  const [state, setState] = useState<SidecarState>(getSidecarState());
  const [open, setOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => subscribeSidecarState(setState), []);

  const handleRestart = useCallback(async () => {
    setRestarting(true);
    try {
      const ok = await restartSidecar();
      if (ok) {
        try {
          const res = await fetchModels();
          onRecovered?.(res.models.length > 0 ? "connected" : "no-models");
        } catch {
          // 復旧したが models 取得が失敗 — no-backend のまま
        }
      }
    } finally {
      setRestarting(false);
    }
  }, [onRecovered]);

  const handleCopy = useCallback(async () => {
    const log = getRecentSidecarLog();
    const lines = [
      `${t("aiChat.diagPlatform")}: ${typeof navigator !== "undefined" ? navigator.userAgent : "unknown"}`,
      `${t("aiChat.diagStatus")}: ${state.status}`,
      `${t("aiChat.diagLastError")}: ${state.lastError ?? "(none)"}`,
      `Last error at: ${state.lastErrorAt ? new Date(state.lastErrorAt).toISOString() : "(never)"}`,
      "",
      `${t("aiChat.diagRecentLog")}:`,
      ...(log.length > 0 ? log : [t("aiChat.diagEmptyLog")]),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API が拒否された場合は無視
    }
  }, [state, t]);

  const message = tauri ? t("aiChat.noBackendTauri") : t("aiChat.noBackend");

  return (
    <div className="px-3 py-2.5 border-b border-border bg-muted/50">
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <AlertCircle size={14} className="mt-0.5 shrink-0" />
        <div className="flex-1 space-y-2">
          <p>{message}</p>
          {tauri && (
            <>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  onClick={handleRestart}
                  disabled={restarting}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border bg-background text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50"
                >
                  <RefreshCw size={11} className={restarting ? "animate-spin" : ""} />
                  {restarting ? t("aiChat.restarting") : t("aiChat.restartBackend")}
                </button>
                <button
                  onClick={() => setOpen(!open)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  {t("aiChat.diagnostics")}
                </button>
              </div>
              {open && (
                <DiagnosticsPanel
                  state={state}
                  copied={copied}
                  onCopy={handleCopy}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type DiagnosticsPanelProps = {
  state: SidecarState;
  copied: boolean;
  onCopy: () => void;
};

function DiagnosticsPanel({ state, copied, onCopy }: DiagnosticsPanelProps) {
  const t = useT();
  const log = getRecentSidecarLog();
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "unknown";

  return (
    <div className="rounded-md border border-border bg-background/80 p-2 space-y-1.5 text-[10px] font-mono">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">
          {t("aiChat.diagStatus")}: <span className="text-foreground">{state.status}</span>
        </span>
        <button
          onClick={onCopy}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          title={t("aiChat.copyDiagnostics")}
        >
          <Copy size={10} />
          {copied ? t("aiChat.copyDiagnosticsDone") : t("aiChat.copyDiagnostics")}
        </button>
      </div>
      <div className="text-muted-foreground break-all">
        {t("aiChat.diagPlatform")}: <span className="text-foreground">{ua}</span>
      </div>
      {state.lastError && (
        <div className="text-amber-700 dark:text-amber-400 whitespace-pre-wrap break-all">
          {t("aiChat.diagLastError")}: {state.lastError}
        </div>
      )}
      <details className="text-muted-foreground">
        <summary className="cursor-pointer hover:text-foreground">
          {t("aiChat.diagRecentLog")} ({log.length})
        </summary>
        <pre className="mt-1 whitespace-pre-wrap break-all text-[10px] max-h-48 overflow-auto bg-muted/40 rounded p-1.5 text-foreground/80">
          {log.length > 0 ? log.join("\n") : t("aiChat.diagEmptyLog")}
        </pre>
      </details>
    </div>
  );
}
