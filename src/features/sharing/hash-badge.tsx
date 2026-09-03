// 共有エントリの hash 検証バッジ。
// SharedLibraryView（詳細パネル）と SharedLibraryTable（一覧の検証列）の
// 両方から使うため、共通コンポーネントとして切り出している。

import { AlertTriangle, CheckCircle2, RefreshCw, ShieldQuestion } from "lucide-react";
import { useT } from "../../i18n";

export type HashStatus = "unknown" | "verifying" | "ok" | "mismatch" | "error";

export function HashBadge({
  status,
  onClick,
}: {
  status: HashStatus;
  onClick: (e: React.MouseEvent) => void;
}) {
  const t = useT();

  if (status === "ok") {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[10px] text-emerald-700 dark:text-emerald-400"
        title={t("library.hash.ok")}
      >
        <CheckCircle2 size={11} />
        {t("library.hash.ok")}
      </span>
    );
  }
  if (status === "mismatch") {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[10px] text-destructive"
        title={t("library.hash.mismatch")}
      >
        <AlertTriangle size={11} />
        {t("library.hash.mismatch")}
      </span>
    );
  }
  if (status === "verifying") {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground"
        title={t("library.hash.verifying")}
      >
        <RefreshCw size={11} className="animate-spin" />
      </span>
    );
  }
  if (status === "error") {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[10px] text-amber-600"
        title={t("library.hash.error")}
      >
        <AlertTriangle size={11} />
        ?
      </span>
    );
  }
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground"
      title={t("library.hash.verify")}
    >
      <ShieldQuestion size={11} />
      {t("library.hash.verify")}
    </button>
  );
}
