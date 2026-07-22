// AI バックエンド (sidecar) が起動できないとき・ユーザーが診断情報を見たいときに
// 表示するパネル。バナー (banner) とヘッダー手動展開 (manual) の 2 バリアント。

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ChevronDown, ChevronRight, Copy, RefreshCw, X } from "lucide-react";
import { useT } from "../../i18n";
import { isTauri, tauriDetectionDetail } from "../../lib/platform";
import {
  getRecentSidecarLog,
  getSidecarState,
  restartSidecar,
  subscribeSidecarState,
  type SidecarState,
} from "../../lib/sidecar";
import { fetchModels } from "./api";

type Variant = "banner" | "manual";

type Props = {
  variant?: Variant;
  /** 手動展開時の閉じるハンドラ */
  onClose?: () => void;
  /** sidecar 再起動が成功し、モデルチェックまで通った場合に呼ばれる */
  onRecovered?: (next: "connected" | "no-models") => void;
  /** ホストコンポーネントが持つ追加の文脈情報（aiStatus 等）を診断ダンプに含める */
  extraContext?: () => string;
};

export function AiBackendDiagnostic({
  variant = "banner",
  onClose,
  onRecovered,
  extraContext,
}: Props) {
  const t = useT();
  const tauri = isTauri();
  const [state, setState] = useState<SidecarState>(getSidecarState());
  // banner: 折り畳み（押されたら展開）/ manual: 常に展開
  const [open, setOpen] = useState(variant === "manual");
  const [restarting, setRestarting] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => subscribeSidecarState(setState), []);

  const handleRestart = useCallback(async () => {
    setRestarting(true);
    try {
      const ok = await restartSidecar();
      if (ok) {
        // 再起動直後は listen 直後の瞬断で 1 発目の fetch が落ちることがある。
        // 少し間隔を空けてリトライし、onRecovered の取りこぼしを防ぐ。
        // （全滅しても panel 側の sidecar ready 購読が再チェックするので致命ではない）
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const res = await fetchModels();
            onRecovered?.(res.models.length > 0 ? "connected" : "no-models");
            break;
          } catch {
            // 復旧したが models 取得が失敗 — 間を置いて再試行
            if (attempt < 2) await new Promise((r) => setTimeout(r, 500));
          }
        }
      }
    } finally {
      setRestarting(false);
    }
  }, [onRecovered]);

  const handleCopy = useCallback(async () => {
    const log = getRecentSidecarLog();
    const protocol = typeof window !== "undefined" && window.location ? window.location.protocol : "unknown";
    const detection = tauriDetectionDetail();
    const lines = [
      `${t("aiChat.diagPlatform")}: ${typeof navigator !== "undefined" ? navigator.userAgent : "unknown"}`,
      `Location protocol: ${protocol}`,
      `Tauri detection: ${detection || "(none — treated as web)"}`,
      `${t("aiChat.diagStatus")}: ${state.status}`,
      `${t("aiChat.diagLastError")}: ${state.lastError ?? "(none)"}`,
      `Last error at: ${state.lastErrorAt ? new Date(state.lastErrorAt).toISOString() : "(never)"}`,
    ];
    if (extraContext) {
      const ctx = extraContext().trim();
      if (ctx) lines.push(`Context: ${ctx}`);
    }
    lines.push("");
    lines.push(`${t("aiChat.diagRecentLog")}:`);
    lines.push(...(log.length > 0 ? log : [t("aiChat.diagEmptyLog")]));

    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API が拒否された場合は無視
    }
  }, [state, t, extraContext]);

  const showMessage = variant === "banner";
  const message = tauri ? t("aiChat.noBackendTauri") : t("aiChat.noBackend");

  return (
    <div className="px-3 py-2.5 border-b border-border bg-muted/50">
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <AlertCircle size={14} className="mt-0.5 shrink-0" />
        <div className="flex-1 space-y-2">
          {showMessage && <p>{message}</p>}
          {(tauri || variant === "manual") && (
            <>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {tauri && (
                  <button
                    onClick={handleRestart}
                    disabled={restarting}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border bg-background text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    <RefreshCw size={11} className={restarting ? "animate-spin" : ""} />
                    {restarting ? t("aiChat.restarting") : t("aiChat.restartBackend")}
                  </button>
                )}
                {variant === "banner" && (
                  <button
                    onClick={() => setOpen(!open)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                    {t("aiChat.diagnostics")}
                  </button>
                )}
                {variant === "manual" && onClose && (
                  <button
                    onClick={onClose}
                    className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-muted-foreground hover:text-foreground transition-colors"
                    title={t("common.close")}
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
              {open && (
                <DiagnosticsPanel
                  state={state}
                  copied={copied}
                  onCopy={handleCopy}
                  extraContext={extraContext}
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
  extraContext?: () => string;
};

function DiagnosticsPanel({ state, copied, onCopy, extraContext }: DiagnosticsPanelProps) {
  const t = useT();
  const log = getRecentSidecarLog();
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "unknown";
  const protocol = typeof window !== "undefined" && window.location ? window.location.protocol : "unknown";
  const detection = tauriDetectionDetail();
  const ctx = extraContext ? extraContext().trim() : "";

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
      <div className="text-muted-foreground">
        Location: <span className="text-foreground">{protocol}</span>
        {" · "}
        Tauri: <span className="text-foreground">{detection || "(none)"}</span>
      </div>
      {ctx && (
        <div className="text-muted-foreground break-all">
          Context: <span className="text-foreground">{ctx}</span>
        </div>
      )}
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
      <div className="text-muted-foreground text-[10px] italic leading-relaxed">
        {t("aiChat.diagBootLogHint")}
      </div>
    </div>
  );
}
