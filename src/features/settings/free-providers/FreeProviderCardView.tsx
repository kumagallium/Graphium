// 無料枠のある接続先の見た目だけの部品。カード 1 枚（FreeProviderCardView）と、
// それを名前の順に並べる一覧（FreeProviderListView）。状態は持たず props で受けて描くだけ。
//
// どの接続先も同じ形・同じ重さで描く（おすすめの印・色分けによる優劣を付けない）。
// 例外は「学習に使う」だけで、データが外で学習に使われることは選ぶ前に目に入るよう警告色にする
// （Copilot ワンクリックの学習の告知と同じ扱い）。

import { ExternalLink } from "lucide-react";
import { useT } from "../../../i18n";
import type { FreeProvider } from "./catalog";

/** 行の右に置くボタン（CopilotOneClickView の行と同じ大きさ） */
const rowBtn = "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors";
const rowPrimary = `${rowBtn} bg-primary text-primary-foreground hover:bg-primary/90`;
const rowSecondary = `${rowBtn} inline-flex items-center gap-1 border border-border text-foreground hover:bg-accent`;

export type FreeProviderCardViewProps = {
  provider: FreeProvider;
  /** API キーを発行するページを開く */
  onOpenSignup: (url: string) => void;
  /** 接続フォームを開く */
  onConnect: (provider: FreeProvider) => void;
};

export function FreeProviderCardView({ provider, onOpenSignup, onConnect }: FreeProviderCardViewProps) {
  const t = useT();
  const k = provider.i18nKey;
  const facts: { label: string; value: string; warn?: boolean }[] = [
    { label: t("settings.freeProviders.label.amount"), value: t(`${k}.amount`) },
    {
      label: t("settings.freeProviders.label.training"),
      value: t(`${k}.training`),
      warn: provider.training === "yes",
    },
    { label: t("settings.freeProviders.label.signup"), value: t(`${k}.signup`) },
  ];

  return (
    <div className="rounded-lg border border-border p-3 text-left">
      <div className="flex items-start justify-between gap-3">
        <h4 className="min-w-0 pt-1 text-xs font-semibold text-foreground">{provider.name}</h4>
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={() => onOpenSignup(provider.signupUrl)} className={rowSecondary}>
            {t("settings.freeProviders.getKey")}
            <ExternalLink size={11} aria-hidden />
          </button>
          <button type="button" onClick={() => onConnect(provider)} className={rowPrimary}>
            {t("settings.freeProviders.connect")}
          </button>
        </div>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {facts.map((f) => (
          <div key={f.label} className="contents">
            <dt className="text-muted-foreground">{f.label}</dt>
            <dd className={f.warn ? "text-warning" : "text-foreground"}>{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export type FreeProviderListViewProps = {
  providers: readonly FreeProvider[];
  onOpenSignup: (url: string) => void;
  onConnect: (provider: FreeProvider) => void;
  /** マニュアルの比較ページを開く */
  onOpenComparison: () => void;
};

export function FreeProviderListView({ providers, onOpenSignup, onConnect, onOpenComparison }: FreeProviderListViewProps) {
  const t = useT();
  const checkedAt = providers.reduce((latest, p) => (p.checkedAt > latest ? p.checkedAt : latest), "");
  return (
    <div className="space-y-2">
      <div>
        <h4 className="text-xs font-semibold text-foreground">{t("settings.freeProviders.title")}</h4>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("settings.freeProviders.summary", { date: checkedAt })}{" "}
          <button type="button" onClick={onOpenComparison} className="text-primary underline-offset-2 hover:underline">
            {t("settings.freeProviders.compareLink")}
          </button>
        </p>
      </div>
      {providers.map((p) => (
        <FreeProviderCardView key={p.id} provider={p} onOpenSignup={onOpenSignup} onConnect={onConnect} />
      ))}
    </div>
  );
}
