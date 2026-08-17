// Settings → ストレージ に置く「検索インデックス」カード
//
// 索引の状態（索引済み件数・構築中の残り）を見せ、壊れたときの逃げ道として
// 「作り直す」を提供する。索引は端末ローカルの再構築可能なキャッシュなので、
// 作り直しはノートデータに一切触れない（reset → 追従フックが reconcile し直す）。

import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@ui/button";
import { useLocale } from "../../i18n";
import { lexicalSearch } from "./service";
import { useLexicalStatus } from "./use-lexical-sync";

export function LexicalIndexCard() {
  const { t } = useLocale();
  const status = useLexicalStatus();
  const [resetting, setResetting] = useState(false);
  const busy = status.state === "indexing" || status.state === "loading" || resetting;

  const summary =
    status.state === "loading"
      ? t("settings.searchIndex.loading")
      : status.state === "indexing"
        ? t("settings.searchIndex.indexing", { pending: String(status.pending) })
        : t("settings.searchIndex.summary", { sources: String(status.sources), chunks: String(status.documents) });

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <Search size={14} className="text-muted-foreground" />
        <h3 className="text-xs font-semibold text-foreground">{t("settings.searchIndex.title")}</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-2">{t("settings.searchIndex.help")}</p>
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          size="sm"
          disabled={busy || !lexicalSearch.isReady()}
          onClick={async () => {
            if (!window.confirm(t("settings.searchIndex.rebuildConfirm"))) return;
            setResetting(true);
            try {
              await lexicalSearch.reset();
            } finally {
              setResetting(false);
            }
          }}
        >
          {busy ? (
            <>
              <Loader2 size={12} className="animate-spin mr-1.5" />
              {t("settings.searchIndex.rebuilding")}
            </>
          ) : (
            t("settings.searchIndex.rebuild")
          )}
        </Button>
        <span className="text-xs text-muted-foreground">{summary}</span>
      </div>
      {status.lastError && (
        <p className="text-xs text-red-500 mt-2">{status.lastError}</p>
      )}
    </div>
  );
}
