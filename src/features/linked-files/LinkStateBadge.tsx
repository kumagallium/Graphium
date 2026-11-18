// リンクした素材の状態の印（5 通り）。既存の Badge の色の使い方をそのまま使う（新しい色は作らない）。
//   変わりなし = success / 変わっています・見つかりません = warning
//   届きません・未登録 = ニュートラル＋破線の枠（色だけに頼らず、責める色にもしない）

import { Check, CloudOff, File, FolderX, RefreshCw } from "lucide-react";
import { Badge } from "@ui/badge";
import { useT } from "../../i18n";
import type { LinkState } from "./linked-entry";

const VARIANT = {
  ok: "success",
  changed: "warning",
  missing: "warning",
  unreachable: "secondary",
  unregistered: "secondary",
} as const;

const ICON = {
  ok: Check,
  changed: RefreshCw,
  missing: File,
  unreachable: CloudOff,
  unregistered: FolderX,
} as const;

export function LinkStateBadge({ state, className = "" }: { state: LinkState; className?: string }) {
  const t = useT();
  const Icon = ICON[state];
  const dashed = state === "unreachable" || state === "unregistered" ? "border-dashed" : "";
  return (
    <Badge
      variant={VARIANT[state]}
      className={`${dashed} ${className}`}
      data-testid="link-state-badge"
      data-state={state}
      data-tooltip={t(`linkedFile.stateDesc.${state}`)}
    >
      <Icon aria-hidden />
      <span className="truncate">{t(`linkedFile.state.${state}`)}</span>
    </Badge>
  );
}

/** 一覧の「リンク」の印（名前の横に置く小さな札） */
export function LinkedBadge() {
  const t = useT();
  return (
    <span
      className="inline-flex items-center gap-0.5 shrink-0 rounded-full border border-border bg-secondary px-1.5 text-[10px] font-semibold text-secondary-foreground"
      data-testid="linked-badge"
      data-tooltip={t("linkedFile.name")}
    >
      {t("linkedFile.badge")}
    </span>
  );
}
