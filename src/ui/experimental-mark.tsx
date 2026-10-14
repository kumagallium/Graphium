// 試験運用の印（i18n 込みの薄いラッパー）
// 各所はこれを置くだけにする。文言とツールチップは experimental.* キーで共通

import { useT } from "../i18n";
import { ExperimentalBadge, type ExperimentalBadgeProps } from "./experimental-badge";

type ExperimentalMarkProps = Omit<ExperimentalBadgeProps, "label" | "tooltip">;

export function ExperimentalMark({ size = "sm", ...props }: ExperimentalMarkProps) {
  const t = useT();
  return (
    <ExperimentalBadge
      label={t("experimental.label")}
      tooltip={t("experimental.tooltip")}
      size={size}
      {...props}
    />
  );
}
