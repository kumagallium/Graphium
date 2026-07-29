// スマホ専用の最小設定シート（捕獲履歴ホームの ⚙ の行き先）。
//
// スマホにはフル設定モーダルを出さない（デスクトップ語彙の受信フォルダ設定や
// 保存タブ一式はスマホでは概念過多）。ここに置くのはスマホで実際に触るものだけ:
//   1. ストレージ — 接続状態・[接続/変更]（→ StoragePickerSheet）・[切断]・
//      詳細（client_id 上書き。セルフホスト/同梱 ID 枯渇時の保険なので畳んでおく）
//   2. 言語 — 日本語 / English（設定モーダルの言語切替と同じ useLocale/setLocale。
//      保存先は localStorage "graphium_locale"）
//   3. アプリ情報 — バージョン（About タブと同じ getAppVersion()。PWA では
//      package.json の version）
//
// **props 駆動のプレゼンテーション層**: push の実体（configured/connected の読み直し、
// disconnect、client_id 保存）は親の usePushSettings が握る。言語とバージョンだけは
// 軽量な既存基盤（i18n / lib/updater）を直接使う — push/ の動的 import 境界とは無関係。

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle,
  ChevronRight,
  Cloud,
  Info,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { useLocale, type Locale } from "../../i18n";
import { getAppVersion } from "../../lib/updater";

export type MobileSettingsSheetProps = {
  /** push モジュールのロードが済んだか。false の間はストレージ操作を無効化する。 */
  ready: boolean;
  /** client_id が解決できるか（同梱 or 自前上書き）。 */
  configured: boolean;
  /** 有効期限内のトークンがあるか。 */
  connected: boolean;
  /** 同梱 client_id のあるビルドか（無いと自前 ID 必須の注記を出す）。 */
  hasBundledId: boolean;
  /** 自前 client_id 上書きの現在値（未設定は空文字）。 */
  clientIdOverride: string;
  onSaveClientId: (value: string) => void;
  onClearClientId: () => void;
  onDisconnect: () => void;
  /** ストレージ選択（StoragePickerSheet）を開く。ピッカーはこのシートの上に重なる。 */
  onOpenStoragePicker: () => void;
  onClose: () => void;
};

export function MobileSettingsSheet({
  ready,
  configured,
  connected,
  hasBundledId,
  clientIdOverride,
  onSaveClientId,
  onClearClientId,
  onDisconnect,
  onOpenStoragePicker,
  onClose,
}: MobileSettingsSheetProps) {
  const { locale, setLocale, t } = useLocale();
  const [version, setVersion] = useState<string>("");
  const [clientIdInput, setClientIdInput] = useState(clientIdOverride);
  const [clientIdSaved, setClientIdSaved] = useState(false);

  // バージョンは About タブと同じ経路（Tauri は実バージョン / PWA は package.json）
  useEffect(() => {
    let cancelled = false;
    getAppVersion()
      .then((v) => { if (!cancelled) setVersion(v); })
      .catch(() => { /* 取得失敗時は空のまま */ });
    return () => { cancelled = true; };
  }, []);

  // 上書き値はモジュールロード後に届く（ready が遅れて立つ）ので prop に追従する
  useEffect(() => {
    setClientIdInput(clientIdOverride);
  }, [clientIdOverride]);

  // ESC で閉じる
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSaveClientId = useCallback(() => {
    onSaveClientId(clientIdInput);
    setClientIdSaved(true);
  }, [onSaveClientId, clientIdInput]);

  const handleClearClientId = useCallback(() => {
    onClearClientId();
    setClientIdInput("");
    setClientIdSaved(false);
  }, [onClearClientId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/40"
      data-testid="mobile-settings-sheet"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background border-t border-border rounded-t-2xl shadow-2xl w-full max-h-[85dvh] flex flex-col overflow-hidden animate-slide-up">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">{t("settings.title")}</h2>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <div className="overflow-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] flex flex-col gap-5">
          {/* ── ストレージ ── */}
          <div>
            <h3 className="text-xs font-semibold text-foreground mb-2">
              {t("mobile.settings.storage")}
            </h3>
            <div className="rounded-lg border border-border bg-card px-3 py-2.5 space-y-2">
              {/* 接続状態 + 接続/変更/切断 */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs min-w-0">
                  {!configured ? (
                    <>
                      <AlertCircle size={13} className="text-muted-foreground shrink-0" />
                      <span className="text-muted-foreground truncate">
                        {t("settings.mobilePush.statusNotConfigured")}
                      </span>
                    </>
                  ) : connected ? (
                    <>
                      <CheckCircle size={13} className="text-green-600 shrink-0" />
                      <span className="text-foreground flex items-center gap-1 min-w-0">
                        <Cloud size={12} className="text-muted-foreground shrink-0" />
                        <span className="truncate">
                          Google Drive・{t("settings.mobilePush.statusConnected")}
                        </span>
                      </span>
                    </>
                  ) : (
                    <>
                      <XCircle size={13} className="text-muted-foreground shrink-0" />
                      <span className="text-muted-foreground truncate">
                        {t("settings.mobilePush.statusDisconnected")}
                      </span>
                    </>
                  )}
                </div>
                <button
                  onClick={onOpenStoragePicker}
                  disabled={!ready}
                  className={`shrink-0 px-2.5 py-1.5 text-xs rounded-md transition-colors disabled:opacity-50 ${
                    connected
                      ? "border border-border text-foreground active:bg-muted"
                      : "bg-primary text-primary-foreground font-medium active:opacity-80"
                  }`}
                >
                  {connected
                    ? t("mobile.settings.changeStorage")
                    : t("settings.mobilePush.connect")}
                </button>
              </div>
              {connected && (
                <button
                  onClick={onDisconnect}
                  disabled={!ready}
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                >
                  {t("settings.mobilePush.disconnect")}
                </button>
              )}

              {/* 同梱 ID の無いビルドでは自前 client ID が必須（設定モーダルと同じ注記） */}
              {!hasBundledId && (
                <p className="pt-1 border-t border-border text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1">
                  <Info size={12} className="mt-0.5 shrink-0" />
                  <span>{t("settings.mobilePush.noDefaultNote")}</span>
                </p>
              )}

              {/* 詳細（client_id 上書き）— 既定は畳む。一般ユーザーには見せない保険 */}
              <details className={`group ${hasBundledId ? "pt-1 border-t border-border" : ""}`}>
                <summary className="cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
                  {t("settings.mobilePush.advanced")}
                </summary>
                <div className="mt-1.5 space-y-1.5">
                  <p className="text-xs text-muted-foreground">
                    {t("settings.mobilePush.advancedHelp")}
                  </p>
                  <div className="text-xs text-muted-foreground">
                    {t("settings.mobilePush.clientIdLabel")}
                  </div>
                  <input
                    type="text"
                    value={clientIdInput}
                    onChange={(e) => {
                      setClientIdInput(e.target.value);
                      setClientIdSaved(false);
                    }}
                    placeholder={t("settings.mobilePush.clientIdPlaceholder")}
                    autoComplete="off"
                    disabled={!ready}
                    className="w-full text-xs px-2.5 py-2 rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition-colors disabled:opacity-50"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSaveClientId}
                      disabled={!ready || clientIdInput.trim() === ""}
                      className="px-2.5 py-1.5 text-xs rounded-md bg-primary text-primary-foreground font-medium active:opacity-80 transition-opacity disabled:opacity-50"
                    >
                      {t("settings.mobilePush.save")}
                    </button>
                    {clientIdInput.trim() !== "" && (
                      <button
                        onClick={handleClearClientId}
                        disabled={!ready}
                        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
                      >
                        <RotateCcw size={12} />
                        {t("settings.mobilePush.clear")}
                      </button>
                    )}
                    {clientIdSaved && (
                      <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                        <CheckCircle size={12} className="text-green-600" />
                        {t("settings.mobilePush.saved")}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("settings.mobilePush.clientIdHelp")}
                  </p>
                </div>
              </details>
            </div>
          </div>

          {/* ── 言語（設定モーダルの言語切替と同じ setLocale — 保存先も同じ） ── */}
          <div>
            <h3 className="text-xs font-semibold text-foreground mb-2">
              {t("settings.language")}
            </h3>
            <div className="flex gap-2">
              {(["en", "ja"] as Locale[]).map((loc) => (
                <button
                  key={loc}
                  onClick={() => setLocale(loc)}
                  className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                    locale === loc
                      ? "border-primary bg-primary/10 text-primary font-medium"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {loc === "en" ? "English" : "日本語"}
                </button>
              ))}
            </div>
          </div>

          {/* ── アプリ情報 ── */}
          <div>
            <h3 className="text-xs font-semibold text-foreground mb-2">
              {t("settings.about.title")}
            </h3>
            <div className="rounded-lg border border-border bg-card px-3 py-2.5 space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("settings.about.appName")}</span>
                <span className="font-medium text-foreground">Graphium</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("settings.about.version")}</span>
                <span className="font-mono text-foreground">{version || "—"}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
