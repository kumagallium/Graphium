// 共有されたノートの「チェックの件数」（3/5）を出す小さな表示。
//
// 出すのは件数だけ。色は付けず、割合や棒にもしない（checklist-count.ts の冒頭を参照）。
// 件数は共有した時点のもので、押せる部品ではない。

import { SquareCheck } from "lucide-react";
import { useT } from "../../i18n";
import { cn } from "../../lib/utils";
import type { SharedChecklistCount } from "./checklist-count";

export function ChecklistCountChip({
  count,
  className,
}: {
  count: SharedChecklistCount | null | undefined;
  className?: string;
}) {
  const t = useT();
  if (!count) return null;
  const hint = t("planRecords.checksHint", { checked: String(count.checked), total: String(count.total) });
  return (
    <span
      data-testid="checklist-count"
      data-tooltip={hint}
      // span は名前を持てない要素なので、役割を付けて「何の件数か」を読み上げに渡す
      role="img"
      aria-label={hint}
      className={cn("inline-flex items-center gap-0.5 text-[11px] text-muted-foreground tabular-nums", className)}
    >
      <SquareCheck size={11} className="self-center" aria-hidden="true" />
      {count.checked}/{count.total}
    </span>
  );
}
