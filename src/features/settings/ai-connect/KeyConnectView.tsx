// つなぎ先を選んだ後の入力画面（試作）。必要な欄だけを出す。
//
// - URL は入力済みで「詳しい設定」の中に畳む（多くの人は触らなくてよい）
// - キーを貼ると、使えるモデルを自動で取ってきて、おすすめを選んでおく（「取得」ボタンは無い）
// - モデル・表示名を変えたい人だけ「詳しい設定」を開く
//
// 見た目だけの部品。取得の状態（phase）は props で受けて描くだけ。

import { AlertCircle, Check, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
import { Input } from "@ui/form-field";
import { useT } from "../../../i18n";

export type KeyConnectPhase =
  /** まだキーが無い */
  | { kind: "idle" }
  /** キーを貼った直後、モデルの一覧を取っている */
  | { kind: "checking" }
  /** つながった。おすすめのモデルを選んである */
  | { kind: "ready"; models: string[]; selected: string }
  /** キーが違う・つながらない */
  | { kind: "error"; message: string };

export type KeyConnectViewProps = {
  /** 画面に出す接続先の名前（「OpenAI につなぐ」） */
  providerName: string;
  /** キーの取り方のページ */
  keyHelpUrl: string;
  /** Cloudflare のようにアカウント ID が要る接続先 */
  needsAccountId?: boolean;
  /** キーが要らない接続先（このパソコンで動かすモデル） */
  keyless?: boolean;
  apiKey: string;
  accountId?: string;
  apiBase: string;
  displayName: string;
  phase: KeyConnectPhase;
  onApiKeyChange: (value: string) => void;
  onAccountIdChange?: (value: string) => void;
  onApiBaseChange: (value: string) => void;
  onModelChange: (model: string) => void;
  onDisplayNameChange: (value: string) => void;
  onOpenKeyHelp: (url: string) => void;
  onBack: () => void;
  onAdd: () => void;
  /** 詳しい設定を最初から開いておく（Storybook 用） */
  initialAdvancedOpen?: boolean;
};

export function KeyConnectView({
  providerName,
  keyHelpUrl,
  needsAccountId = false,
  keyless = false,
  apiKey,
  accountId = "",
  apiBase,
  displayName,
  phase,
  onApiKeyChange,
  onAccountIdChange,
  onApiBaseChange,
  onModelChange,
  onDisplayNameChange,
  onOpenKeyHelp,
  onBack,
  onAdd,
  initialAdvancedOpen = false,
}: KeyConnectViewProps) {
  const t = useT();
  const [advancedOpen, setAdvancedOpen] = useState(initialAdvancedOpen);
  const label = "mb-1.5 block text-xs font-medium text-foreground";

  return (
    <div className="space-y-3 text-left">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft size={12} /> {t("settings.aiConnect.back")}
      </button>
      <h4 className="text-sm font-semibold text-foreground">
        {t("settings.aiConnect.form.title", { name: providerName })}
      </h4>

      {needsAccountId && (
        <div>
          <label className={label}>{t("settings.freeProviders.accountId")}</label>
          <Input
            type="text"
            value={accountId}
            onChange={(e) => onAccountIdChange?.(e.target.value)}
            className="font-mono text-sm"
          />
          <p className="mt-1 text-xs text-muted-foreground">{t("settings.freeProviders.accountIdHint")}</p>
        </div>
      )}

      {!keyless && (
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label className="text-xs font-medium text-foreground">{t("settings.aiConnect.form.key")}</label>
            <button
              type="button"
              onClick={() => onOpenKeyHelp(keyHelpUrl)}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline underline-offset-2"
            >
              {t("settings.aiConnect.form.keyHelp")}
              <ExternalLink size={10} aria-hidden />
            </button>
          </div>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            placeholder={t("settings.aiConnect.form.keyPlaceholder")}
            className="font-mono text-sm"
          />
        </div>
      )}

      {/* 取得の状態。キーを貼ると自動で確かめる */}
      <div className="min-h-5 text-xs" role="status">
        {phase.kind === "idle" && (
          <span className="text-muted-foreground">
            {t(keyless ? "settings.aiConnect.form.idleKeyless" : "settings.aiConnect.form.idle")}
          </span>
        )}
        {phase.kind === "checking" && (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Loader2 size={12} className="animate-spin" /> {t("settings.aiConnect.form.checking")}
          </span>
        )}
        {phase.kind === "ready" && (
          <span className="inline-flex items-center gap-1.5 text-foreground">
            <Check size={12} className="text-primary" />
            {t("settings.aiConnect.form.ready", { model: phase.selected, count: String(phase.models.length) })}
          </span>
        )}
        {phase.kind === "error" && (
          <span className="inline-flex items-start gap-1.5 text-destructive">
            <AlertCircle size={12} className="mt-0.5 shrink-0" /> {phase.message}
          </span>
        )}
      </div>

      {/* 詳しい設定: URL・モデル・表示名。多くの人は開かなくてよい */}
      <div className="rounded-lg border border-border">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          aria-expanded={advancedOpen}
          className="flex w-full items-center gap-1 px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
        >
          {advancedOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {t("settings.aiConnect.form.advanced")}
        </button>
        {advancedOpen && (
          <div className="space-y-3 border-t border-border p-3">
            <div>
              <label className={label}>API Base URL</label>
              <Input type="text" value={apiBase} onChange={(e) => onApiBaseChange(e.target.value)} className="text-sm" />
            </div>
            <div>
              <label className={label}>{t("settings.aiConnect.form.model")}</label>
              <select
                value={phase.kind === "ready" ? phase.selected : ""}
                onChange={(e) => onModelChange(e.target.value)}
                disabled={phase.kind !== "ready"}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm disabled:opacity-60"
              >
                {phase.kind === "ready" ? (
                  phase.models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))
                ) : (
                  <option value="">{t("settings.aiConnect.form.modelPending")}</option>
                )}
              </select>
            </div>
            <div>
              <label className={label}>{t("settings.aiConnect.form.displayName")}</label>
              <Input
                type="text"
                value={displayName}
                onChange={(e) => onDisplayNameChange(e.target.value)}
                className="text-sm"
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onAdd}
          disabled={phase.kind !== "ready"}
          className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {t("settings.aiConnect.form.add")}
        </button>
      </div>
    </div>
  );
}
