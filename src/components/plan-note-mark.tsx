// 計画ノートの印。v0.154.0 で計画を「計画」フォルダではなくノートの種類（kind）で持つように
// したため、フォルダの名前で計画と分かる手がかりが無くなった。その代わりに、開いたノートの
// ヘッダーと一覧の行に同じ印を出す。アイコンは右上メニューの「計画として扱う」と同じ ClipboardList。
import { ClipboardList } from "lucide-react";
import { useT } from "../i18n";

/** 開いたノートのヘッダー、題の左に出す小さな札。共有済みの札と同じ大きさと色 */
export function PlanNoteChip() {
  const t = useT();
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary shrink-0 inline-flex items-center gap-1"
      data-tooltip={t("plan.markTooltip")}
      data-testid="note-header-plan-chip"
    >
      <ClipboardList size={10} aria-hidden />
      {t("plan.mark")}
    </span>
  );
}

/** ノートの一覧の行、題の右に出すアイコンだけの印。共有の印と並ぶ */
export function PlanNoteMark() {
  const t = useT();
  return (
    <span
      className="ml-1.5 inline-flex align-middle text-primary"
      data-tooltip={t("plan.markTooltip")}
      aria-label={t("plan.mark")}
      role="img"
      data-testid="note-list-plan-mark"
    >
      <ClipboardList size={12} aria-hidden />
    </span>
  );
}
