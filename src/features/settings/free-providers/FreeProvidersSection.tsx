// 設定 → AI の空の状態に置く「無料枠のある接続先」の開閉つきの枠。
//
// 初めて見たときだけ開いて置き、次からは畳む（useOpenOnFirstVisit）。この部品は空の状態が
// 実際に出たときにだけ描かれるので、「見た」の記録もそのときにだけ付く（設定を開いただけ・
// モデル登録済みの人には付かない）。

import { ChevronDown, ChevronRight } from "lucide-react";
import { useLocale } from "../../../i18n";
import { openExternalUrl } from "../../../lib/external-link";
import { useOpenOnFirstVisit } from "../SettingsGroup";
import { FREE_PROVIDERS, type FreeProvider } from "./catalog";
import { FreeProviderListView } from "./FreeProviderCardView";

const MANUAL_BASE = "https://kumagallium.github.io/Graphium/manual/";

export function FreeProvidersSection({ onConnect }: { onConnect: (provider: FreeProvider) => void }) {
  const { locale, t } = useLocale();
  const [open, toggle] = useOpenOnFirstVisit("ai-free-providers");
  return (
    <div className="mt-3 border-t border-border pt-3 text-left">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {t(open ? "settings.freeProviders.hideList" : "settings.freeProviders.showList")}
      </button>
      {open && (
        <div className="mt-2">
          <FreeProviderListView
            providers={FREE_PROVIDERS}
            onOpenSignup={(url) => void openExternalUrl(url)}
            onConnect={onConnect}
            onOpenComparison={() =>
              void openExternalUrl(`${MANUAL_BASE}${locale === "ja" ? "ja/" : ""}ai-usage-limits`)
            }
          />
        </div>
      )}
    </div>
  );
}
