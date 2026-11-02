// 設定 → ストレージ →「Web クリップ」の中身。ブラウザ拡張機能に入れるペアリングコードを出す。
//
// コードは合言葉そのものなので、既定では伏せて見せる（画面共有・スクショで漏れないように）。
// コピーと作り直しだけを置く。拡張機能の入手先と手順はマニュアルへ案内する。

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Eye, EyeOff, RotateCcw } from "lucide-react";
import { useT } from "../../i18n";
import { Button } from "@ui/button";
import { fetchPairingCode, resetPairingCode } from "./api";

export type WebClipSettingsProps = {
  /** テスト・Storybook 用の差し替え */
  loadCode?: () => Promise<string | null>;
  resetCode?: () => Promise<string | null>;
};

export function maskPairingCode(code: string): string {
  const dot = code.indexOf(".");
  if (dot < 0) return "•".repeat(12);
  return `${code.slice(0, dot + 1)}${"•".repeat(12)}`;
}

export function WebClipSettings({ loadCode = fetchPairingCode, resetCode = resetPairingCode }: WebClipSettingsProps) {
  const t = useT();
  const [code, setCode] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadCode().then((c) => {
      if (cancelled) return;
      setCode(c);
      setState(c ? "ready" : "unavailable");
    });
    return () => {
      cancelled = true;
    };
  }, [loadCode]);

  const handleCopy = useCallback(async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // クリップボードが使えない環境では表示から手で写してもらう
      setShown(true);
    }
  }, [code]);

  const handleReset = useCallback(async () => {
    setConfirmReset(false);
    const next = await resetCode();
    if (next) {
      setCode(next);
      setShown(true);
    }
  }, [resetCode]);

  if (state === "loading") {
    return <p className="text-xs text-muted-foreground">{t("webClip.settings.loading")}</p>;
  }
  if (state === "unavailable" || !code) {
    return <p className="text-xs text-muted-foreground">{t("webClip.settings.unavailable")}</p>;
  }

  return (
    <div className="rounded-md border border-border bg-background px-3 py-2 space-y-2">
      <div className="text-xs text-muted-foreground">{t("webClip.settings.codeLabel")}</div>
      <div className="flex items-center gap-2">
        <code
          className="flex-1 min-w-0 text-xs font-mono text-foreground break-all select-all"
          data-testid="web-clip-pairing-code"
        >
          {shown ? code : maskPairingCode(code)}
        </code>
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          className="text-muted-foreground hover:text-foreground p-1"
          aria-label={shown ? t("webClip.settings.hide") : t("webClip.settings.show")}
          title={shown ? t("webClip.settings.hide") : t("webClip.settings.show")}
        >
          {shown ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="ghost" onClick={handleCopy}>
          {copied ? <Check size={12} className="mr-1" /> : <Copy size={12} className="mr-1" />}
          {copied ? t("webClip.settings.copied") : t("webClip.settings.copy")}
        </Button>
        {confirmReset ? (
          <span className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">{t("webClip.settings.resetConfirm")}</span>
            <Button size="sm" variant="ghost" onClick={handleReset}>
              {t("webClip.settings.resetYes")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>
              {t("common.cancel")}
            </Button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <RotateCcw size={12} />
            {t("webClip.settings.reset")}
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t("webClip.settings.codeHelp")}</p>
    </div>
  );
}
