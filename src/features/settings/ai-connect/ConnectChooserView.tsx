// AI のつなぎ先を選ぶ画面（試作）。「モデルを追加」の最初の 1 枚。
//
// 技術の言葉（プロバイダー・API Base URL）から始めず、「どこにつなぐか」をふだんの言葉で選ぶ。
// 選んだ先に必要な欄だけを次の画面（KeyConnectView）で出す。URL を自分で入れる今のフォームは
// 「その他」に残す（詳しい人の使い方は変えない）。
//
// 見た目だけの部品。開いている行の状態だけをここで持つ。

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useLocale } from "../../../i18n";
import { providerName, type FreeProvider } from "../free-providers/catalog";
import { FreeProviderListView } from "../free-providers/FreeProviderCardView";

/** API キーでつなぐ主な接続先 */
export type KeyProviderId = "openai" | "anthropic" | "google";
/** このパソコンで動かすモデル */
export type LocalProviderId = "ollama" | "lmstudio";

const KEY_PROVIDERS: { id: KeyProviderId; name: string }[] = [
  { id: "anthropic", name: "Anthropic (Claude)" },
  { id: "google", name: "Google (Gemini)" },
  { id: "openai", name: "OpenAI (ChatGPT)" },
];
const LOCAL_PROVIDERS: { id: LocalProviderId; name: string }[] = [
  { id: "lmstudio", name: "LM Studio" },
  { id: "ollama", name: "Ollama" },
];

type RowId = "free" | "key" | "local";

export type ConnectChooserViewProps = {
  freeProviders: readonly FreeProvider[];
  onConnectCopilot: () => void;
  onPickFree: (provider: FreeProvider) => void;
  onPickKeyProvider: (id: KeyProviderId) => void;
  onPickLocal: (id: LocalProviderId) => void;
  onPickCustom: () => void;
  onOpenSignup: (url: string) => void;
  onOpenComparison: () => void;
  /** 最初に開いておく行（Storybook 用） */
  initialOpen?: RowId | null;
};

const rowClass = "rounded-lg border border-border text-left";
const rowPrimary =
  "shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors";
const chip =
  "rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors";

export function ConnectChooserView({
  freeProviders,
  onConnectCopilot,
  onPickFree,
  onPickKeyProvider,
  onPickLocal,
  onPickCustom,
  onOpenSignup,
  onOpenComparison,
  initialOpen = null,
}: ConnectChooserViewProps) {
  const { t, locale } = useLocale();
  const [open, setOpen] = useState<RowId | null>(initialOpen);
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
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-foreground">{t("settings.aiConnect.question")}</h4>

      {/* GitHub Copilot: ボタン 1 つでつなぐ（今のワンクリック接続） */}
      <div className={`${rowClass} flex items-start justify-between gap-3 p-3`}>
        <div className="min-w-0 pl-5">
          <span className="block text-xs font-semibold text-foreground">{t("settings.aiConnect.copilot.title")}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{t("settings.aiConnect.copilot.summary")}</span>
        </div>
        <button type="button" onClick={onConnectCopilot} className={rowPrimary}>
          {t("settings.freeProviders.connect")}
        </button>
      </div>

      {expandable(
        "free",
        t("settings.aiConnect.free.title"),
        t("settings.aiConnect.free.summary", {
          names: freeProviders.map((p) => providerName(p, locale)).join(locale === "ja" ? "・" : ", "),
        }),
        <FreeProviderListView
          providers={freeProviders}
          onOpenSignup={onOpenSignup}
          onConnect={onPickFree}
          onOpenComparison={onOpenComparison}
        />,
      )}

      {expandable(
        "key",
        t("settings.aiConnect.key.title"),
        t("settings.aiConnect.key.summary"),
        <div className="flex flex-wrap gap-2">
          {KEY_PROVIDERS.map((p) => (
            <button key={p.id} type="button" onClick={() => onPickKeyProvider(p.id)} className={chip}>
              {p.name}
            </button>
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

      {/* その他: URL を自分で入れる今のフォームへ */}
      <button
        type="button"
        onClick={onPickCustom}
        className="inline-flex items-center gap-1 pl-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {t("settings.aiConnect.custom")}
        <ChevronRight size={10} aria-hidden />
      </button>
    </div>
  );
}
