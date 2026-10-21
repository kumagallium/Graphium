// Copilot ワンクリック接続の見た目だけの部品。状態は props で受けて描くだけ。

import { Check, Copy, Loader2 } from "lucide-react";
import { useT } from "../../../i18n";
import { installPercent, type Phase } from "./state";

const primaryBtn =
  "inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60";
const subBtn =
  "rounded-lg border border-border px-2 py-0.5 text-xs text-foreground hover:bg-accent transition-colors";

const MB = 1_000_000;

/** エラーコードを文言キーに結びつける。未知のコードはサーバーの文言をそのまま出す */
const ERROR_KEYS: Record<string, string> = {
  COPILOT_NOT_SIGNED_IN: "settings.copilotOneClick.error.notSignedIn",
  COPILOT_NO_ACCESS: "settings.copilotOneClick.error.noAccess",
  COPILOT_CHECK_FAILED: "settings.copilotOneClick.error.checkFailed",
  COPILOT_CLI_MISSING: "settings.copilotOneClick.error.cliMissing",
  COPILOT_CLI_UNSUPPORTED_PLATFORM: "settings.copilotOneClick.error.unsupportedPlatform",
  ALREADY_INSTALLING: "settings.copilotOneClick.error.alreadyInstalling",
  ALREADY_SIGNING_IN: "settings.copilotOneClick.error.alreadySigningIn",
};

export type CopilotOneClickViewProps = {
  phase: Phase;
  /** コードをコピーした直後 */
  copied?: boolean;
  onStart: () => void;
  onCancelInstall: () => void;
  onCancelLogin: () => void;
  onUseDeviceCode: () => void;
  onCopyCode: (code: string) => void;
  onOpenGithub: (url: string) => void;
  onOpenCopilotSettings: () => void;
  /** 失敗からやり直す（取得・ログイン失敗の両方） */
  onRetry: () => void;
  onRecheck: () => void;
};

export function CopilotOneClickView({
  phase,
  copied = false,
  onStart,
  onCancelInstall,
  onCancelLogin,
  onUseDeviceCode,
  onCopyCode,
  onOpenGithub,
  onOpenCopilotSettings,
  onRetry,
  onRecheck,
}: CopilotOneClickViewProps) {
  const t = useT();
  const errorText = (code: string | null, message: string | null) => {
    const key = code ? ERROR_KEYS[code] : undefined;
    return key ? t(key) : message || t("settings.copilotOneClick.error.generic");
  };

  switch (phase.kind) {
    case "loading":
    case "unavailable":
      return null;

    case "idle":
      return (
        <button type="button" onClick={onStart} className={primaryBtn}>
          {t("settings.copilotOneClick.button")}
        </button>
      );

    case "preparing":
    case "verifying":
    case "connected":
      return (
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2 size={12} className="animate-spin" />
          {t("settings.copilotOneClick.verifying")}
        </div>
      );

    case "installing": {
      const percent = installPercent(phase.received, phase.total);
      return (
        <div className="mx-auto max-w-xs space-y-1" role="status">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {percent === null
                ? t("settings.copilotOneClick.installingUnknown")
                : t("settings.copilotOneClick.installing", {
                    received: String(Math.round(phase.received / MB)),
                    total: String(Math.round(phase.total / MB)),
                  })}
            </span>
            <button type="button" className={subBtn} onClick={onCancelInstall}>
              {t("settings.copilotOneClick.cancel")}
            </button>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={percent ?? undefined}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={`h-full rounded-full bg-primary transition-[width] duration-300 ${percent === null ? "animate-pulse" : ""}`}
              style={{ width: `${percent ?? 100}%` }}
            />
          </div>
        </div>
      );
    }

    case "installError":
      return (
        <div className="space-y-2">
          <p className="text-xs text-destructive">
            {t("settings.copilotOneClick.installFailed", { reason: errorText(phase.code, phase.message) })}
          </p>
          {phase.code !== "COPILOT_CLI_UNSUPPORTED_PLATFORM" && (
            <button type="button" className={primaryBtn} onClick={onRetry}>
              {t("settings.copilotOneClick.retry")}
            </button>
          )}
        </div>
      );

    case "login":
      return (
        <div className="space-y-2" role="status">
          {phase.mode === "device" && phase.userCode ? (
            <>
              <p className="text-xs text-muted-foreground">{t("settings.copilotOneClick.codePrompt")}</p>
              <div className="flex items-center justify-center gap-2">
                <span className="rounded-md bg-muted px-3 py-1.5 font-mono text-lg font-semibold tracking-wider text-foreground select-all">
                  {phase.userCode}
                </span>
                <button
                  type="button"
                  className={subBtn}
                  onClick={() => onCopyCode(phase.userCode ?? "")}
                  aria-label={t("settings.copilotOneClick.copyCode")}
                >
                  {copied ? <Check size={12} className="inline" /> : <Copy size={12} className="inline" />}{" "}
                  {copied ? t("settings.copilotOneClick.copied") : t("settings.copilotOneClick.copyCode")}
                </button>
              </div>
              {phase.verificationUri && (
                <button type="button" className={primaryBtn} onClick={() => onOpenGithub(phase.verificationUri ?? "")}>
                  {t("settings.copilotOneClick.openGithub")}
                </button>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 size={12} className="animate-spin" />
              {phase.mode === "device"
                ? t("settings.copilotOneClick.codePreparing")
                : t("settings.copilotOneClick.waitingBrowser")}
            </div>
          )}
          <div className="flex items-center justify-center gap-2">
            {phase.mode === "web" && (
              <button type="button" className={subBtn} onClick={onUseDeviceCode}>
                {t("settings.copilotOneClick.useCode")}
              </button>
            )}
            <button type="button" className={subBtn} onClick={onCancelLogin}>
              {t("settings.copilotOneClick.cancel")}
            </button>
          </div>
        </div>
      );

    case "noAccess":
      return (
        <div className="space-y-2">
          <p className="text-xs text-foreground">{t("settings.copilotOneClick.noAccess")}</p>
          <div className="flex items-center justify-center gap-2">
            <button type="button" className={primaryBtn} onClick={onOpenCopilotSettings}>
              {t("settings.copilotOneClick.enableCopilot")}
            </button>
            <button type="button" className={subBtn} onClick={onRecheck}>
              {t("settings.copilotOneClick.recheck")}
            </button>
          </div>
        </div>
      );

    case "loginError":
      return (
        <div className="space-y-2">
          <p className="text-xs text-destructive">
            {phase.code === "COPILOT_CHECK_FAILED"
              ? t("settings.copilotOneClick.error.checkFailed")
              : t("settings.copilotOneClick.loginFailed", { reason: errorText(phase.code, phase.message) })}
          </p>
          <button type="button" className={primaryBtn} onClick={onRetry}>
            {t("settings.copilotOneClick.retry")}
          </button>
        </div>
      );
  }
}
