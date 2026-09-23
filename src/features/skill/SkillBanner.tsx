// Skill バナー（エディタヘッダーに表示）
// Wiki の WikiBanner と同等の役割

import { useState } from "react";
import { Languages, Wrench, Zap, Pencil } from "lucide-react";
import { useT } from "../../i18n";

type Props = {
  availableForIngest: boolean;
  systemSkillId?: string;
  language?: "ja" | "en";
  /** 「編集」ボタン押下時。未指定なら編集ボタンを表示しない。 */
  onEdit?: () => void;
  onSwitchKnowledgeSchemaLanguage?: (language: "ja" | "en") => Promise<void>;
};

export function SkillBanner({
  availableForIngest,
  systemSkillId,
  language,
  onEdit,
  onSwitchKnowledgeSchemaLanguage,
}: Props) {
  const t = useT();
  const [switching, setSwitching] = useState(false);
  const targetLanguage = language === "ja" ? "en" : "ja";
  const canSwitchLanguage =
    systemSkillId === "knowledge-schema" &&
    (language === "ja" || language === "en") &&
    onSwitchKnowledgeSchemaLanguage;

  const handleSwitchLanguage = async () => {
    if (!canSwitchLanguage || switching) return;
    const targetLabel = targetLanguage === "ja" ? t("skill.langJa") : t("skill.langEn");
    if (!window.confirm(t("skill.switchSchemaLanguageConfirm", { language: targetLabel }))) return;
    setSwitching(true);
    try {
      await onSwitchKnowledgeSchemaLanguage(targetLanguage);
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 text-xs">
      <Wrench size={12} className="text-amber-600 dark:text-amber-400" />
      <span className="text-amber-700 dark:text-amber-300 font-medium">{t("sidebar.skill")}</span>
      {availableForIngest && (
        <span className="flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
          <Zap size={10} />
          <span>{t("skill.autoApplyBadge")}</span>
        </span>
      )}
      {onEdit && (
        <>
          <div className="flex-1" />
          {canSwitchLanguage && (
            <button
              onClick={handleSwitchLanguage}
              disabled={switching}
              className="flex items-center gap-1 text-amber-700 dark:text-amber-300 hover:opacity-80 transition-opacity disabled:opacity-50"
              title={t("skill.switchSchemaLanguageTooltip")}
            >
              <Languages size={11} />
              <span>
                {targetLanguage === "ja"
                  ? t("skill.switchSchemaToJapanese")
                  : t("skill.switchSchemaToEnglish")}
              </span>
            </button>
          )}
          <button
            onClick={onEdit}
            className="flex items-center gap-1 text-amber-700 dark:text-amber-300 hover:opacity-80 transition-opacity"
            title={t("skill.editTooltip")}
          >
            <Pencil size={11} />
            <span>{t("skill.edit")}</span>
          </button>
        </>
      )}
    </div>
  );
}
