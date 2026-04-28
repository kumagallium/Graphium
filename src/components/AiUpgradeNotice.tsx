// AI 機能が無効な環境（GH Pages 等のプレビュー版）でデスクトップ / Docker への導線を出すコンポーネント

import { Sparkles, ExternalLink } from "lucide-react";
import { useT } from "../i18n";

type Variant = "card" | "inline" | "footer";

export function AiUpgradeNotice({ variant = "card" }: { variant?: Variant }) {
  const t = useT();
  const releasesUrl = "https://github.com/kumagallium/Graphium/releases/latest";
  const dockerUrl = "https://github.com/kumagallium/Graphium#option-2-run-with-docker--editor-only";

  if (variant === "inline") {
    return (
      <span className="text-[11px] text-muted-foreground/80">
        {t("upgrade.inline")}
      </span>
    );
  }

  if (variant === "footer") {
    return (
      <a
        href={releasesUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <Sparkles size={11} />
        {t("upgrade.footer")}
      </a>
    );
  }

  // card
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <Sparkles size={14} className="text-primary" />
        <span className="text-xs font-semibold">{t("upgrade.title")}</span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{t("upgrade.body")}</p>
      <div className="flex flex-wrap gap-2 pt-1">
        <a
          href={releasesUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
        >
          {t("upgrade.desktopCta")}
          <ExternalLink size={11} />
        </a>
        <a
          href={dockerUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border text-foreground text-xs hover:bg-accent transition-colors"
        >
          {t("upgrade.dockerCta")}
          <ExternalLink size={11} />
        </a>
      </div>
    </div>
  );
}
