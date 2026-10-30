// AI のつなぎ先を選ぶ画面。「モデルを追加」の最初の 1 枚。
//
// 技術の言葉（プロバイダー・API Base URL）から始めず、「どこにつなぐか」をふだんの言葉で選ぶ。
// 選んだ先に必要な欄だけを次の画面（KeyConnectView）で出す。URL を自分で入れる今のフォームは
// 「URL を指定してつなぐ」に残す（詳しい人の使い方は変えない）。
//
// 見た目だけの部品。開いている行の状態だけをここで持つ。

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useLocale } from "../../../i18n";
import { hasFreeTier, isCatalogStale, latestCheckedAt, type FreeProvider } from "../free-providers/catalog";
import { FreeProviderCardView } from "../free-providers/FreeProviderCardView";

/** このパソコンで動かすモデル */
export type LocalProviderId = "ollama" | "lmstudio";

const LOCAL_PROVIDERS: { id: LocalProviderId; name: string }[] = [
  { id: "lmstudio", name: "LM Studio" },
  { id: "ollama", name: "Ollama" },
];

type RowId = "cloud" | "local";

export type ConnectChooserViewProps = {
  /** API キーでつなぐクラウドの接続先（無料枠の有無を問わず、英語名の順） */
  cloudProviders: readonly FreeProvider[];
  /** GitHub Copilot のワンクリック接続（デスクトップのみ。無ければ行を出さない） */
  onConnectCopilot?: () => void;
  onPickCloud: (provider: FreeProvider) => void;
  onPickLocal: (id: LocalProviderId) => void;
  /** 登録済みの接続先（同じ接続先に別のモデルを足す）。空なら行を出さない */
  existingGroups?: { id: string; label: string }[];
  onPickExisting?: (id: string) => void;
  /** GitHub の Copilot 設定（学習への利用を止める）を開く */
  onOpenCopilotSettings?: () => void;
  onPickCustom: () => void;
  onOpenSignup: (url: string) => void;
  onOpenComparison: () => void;
  /** 最初に開いておく行（Storybook 用） */
  initialOpen?: RowId | null;
  /** 古さの判定に使う今の時刻（Storybook とテストで差し替える） */
  now?: Date;
};

const rowClass = "rounded-lg border border-border text-left";
const rowPrimary =
  "shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors";
const chip =
  "rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors";

export function ConnectChooserView({
  cloudProviders,
  onConnectCopilot,
  onPickCloud,
  onPickLocal,
  existingGroups = [],
  onPickExisting,
  onOpenCopilotSettings,
  onPickCustom,
  onOpenSignup,
  onOpenComparison,
  initialOpen = null,
  now = new Date(),
}: ConnectChooserViewProps) {
  const { t } = useLocale();
  const [open, setOpen] = useState<RowId | null>(initialOpen);
  const [freeOnly, setFreeOnly] = useState(false);
  const shown = freeOnly ? cloudProviders.filter(hasFreeTier) : cloudProviders;
  const checkedAt = latestCheckedAt(cloudProviders);
  const toggle = (id: RowId) => setOpen((cur) => (cur === id ? null : id));

  const expandable = (id: RowId, title: string, summary: string, body: ReactNode) => (
    <div className={rowClass}>
      <button
        type="button"
        onClick={() => toggle(id)}
        aria-expanded={open === id}
        className="flex w-full items-start gap-2 p-3 text-left hover:bg-accent/40 rounded-lg"
      >
        <span className="mt-0.5 text-muted-foreground">
          {open === id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-foreground">{title}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{summary}</span>
        </span>
      </button>
      {open === id && <div className="border-t border-border p-3">{body}</div>}
    </div>
  );

  return (
    <div className="space-y-2 text-left">
      <h4 className="text-xs font-semibold text-foreground">{t("settings.aiConnect.question")}</h4>

      {/* 登録済みの接続先に別のモデルを足す（今までの「既存プロバイダーから追加」） */}
      {existingGroups.length > 0 && onPickExisting && (
        <div className={`${rowClass} p-3`}>
          <span className="block pl-5 text-xs font-semibold text-foreground">{t("settings.aiConnect.existing.title")}</span>
          <div className="mt-2 flex flex-wrap gap-2 pl-5">
            {existingGroups.map((g) => (
              <button key={g.id} type="button" onClick={() => onPickExisting(g.id)} className={chip}>
                {g.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* GitHub Copilot: ボタン 1 つでつなぐ（今のワンクリック接続） */}
      {onConnectCopilot && (
      <div className={`${rowClass} flex items-start justify-between gap-3 p-3`}>
        <div className="min-w-0 pl-5">
          <span className="block text-xs font-semibold text-foreground">{t("settings.aiConnect.copilot.title")}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{t("settings.aiConnect.copilot.summary")}</span>
          {/* 押すとすぐ接続が始まるので、ノートの送り先と学習への利用は押す前にここで伝える */}
          <span className="mt-1 block text-xs text-muted-foreground">
            {t("settings.copilotOneClick.dataNotice")}{" "}
            {onOpenCopilotSettings && (
              <button type="button" onClick={onOpenCopilotSettings} className="text-primary underline-offset-2 hover:underline">
                {t("settings.copilotOneClick.dataNoticeLink")}
              </button>
            )}
          </span>
        </div>
        <button type="button" onClick={onConnectCopilot} className={rowPrimary}>
          {t("settings.freeProviders.connect")}
        </button>
      </div>
      )}

      {expandable(
        "cloud",
        t("settings.aiConnect.cloud.title"),
        t("settings.aiConnect.cloud.summary"),
        <div className="space-y-2">
          {/* 無料で始めたい人向けの絞り込みは一覧の一番上に置く */}
          <label className="flex items-center gap-2 text-xs text-foreground">
            <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} />
            {t("settings.aiConnect.cloud.freeOnly")}
          </label>
          <p className="text-xs text-muted-foreground">
            {t("settings.aiConnect.cloud.note", { date: checkedAt })}{" "}
            <button type="button" onClick={onOpenComparison} className="text-primary underline-offset-2 hover:underline">
              {t("settings.freeProviders.compareLink")}
            </button>
          </p>
          {isCatalogStale(checkedAt, now) && (
            <p className="text-xs text-warning" role="note">
              {t("settings.freeProviders.stale", { date: checkedAt })}
            </p>
          )}
          {shown.map((p) => (
            <FreeProviderCardView key={p.id} provider={p} onOpenSignup={onOpenSignup} onConnect={onPickCloud} />
          ))}
        </div>,
      )}

      {expandable(
        "local",
        t("settings.aiConnect.local.title"),
        t("settings.aiConnect.local.summary"),
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {LOCAL_PROVIDERS.map((p) => (
              <button key={p.id} type="button" onClick={() => onPickLocal(p.id)} className={chip}>
                {p.name}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t("settings.aiConnect.local.note")}</p>
        </div>,
      )}

      {/* URL を自分で入れる今のフォームへ。会社・研究室のサーバーにつなぐ人も多いので、ほかと同じ行で出す */}
      <button
        type="button"
        onClick={onPickCustom}
        className={`${rowClass} flex w-full items-start gap-2 p-3 hover:bg-accent/40`}
      >
        <span className="mt-0.5 text-muted-foreground">
          <ChevronRight size={12} aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-foreground">{t("settings.aiConnect.custom")}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{t("settings.aiConnect.custom.summary")}</span>
        </span>
      </button>
    </div>
  );
}
