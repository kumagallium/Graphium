// Skill リストビュー（メインエリアに表示）
// プロンプトテンプレートの一覧表示・新規作成・削除

import { useMemo, useState } from "react";
import { Wrench, Search, Trash2, Plus, Zap, Lock, RotateCcw, Pencil } from "lucide-react";
import type { GraphiumFile, SkillMeta } from "../../lib/document-types";
import { Breadcrumb } from "../../components/Breadcrumb";
import { useT } from "../../i18n";

/** 日付を YYYY-MM-DD 形式でフォーマット */
function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
}

type SkillEntry = {
  id: string;
  title: string;
  description: string;
  availableForIngest: boolean;
  modifiedAt: string;
  systemSkillId?: string;
  language?: "ja" | "en";
};

type Props = {
  skillFiles: GraphiumFile[];
  skillMetas: Map<string, { title: string; description: string; availableForIngest: boolean; systemSkillId?: string; language?: "ja" | "en" }>;
  /** クリック時（サイドピーク or 編集表示） */
  onOpenSkill: (skillId: string) => void;
  /** ダブ���クリック or フルで開く */
  onOpenSkillFull?: (skillId: string) => void;
  onBack: () => void;
  onDeleteSkill: (skillId: string) => Promise<void>;
  onNewSkill: () => void;
  /** 編集ダイアログを開く（説明・Ingest 自動適用・言語・タイトルの修正） */
  onEditSkill: (skillId: string) => void;
  /** システムスキルをデフォルト内容に戻す */
  onResetSystemSkill?: (skillId: string) => Promise<void>;
};

export function SkillListView({
  skillFiles,
  skillMetas,
  onOpenSkill,
  onOpenSkillFull,
  onBack,
  onDeleteSkill,
  onNewSkill,
  onEditSkill,
  onResetSystemSkill,
}: Props) {
  const t = useT();
  const [searchQuery, setSearchQuery] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const skillEntries = useMemo<SkillEntry[]>(() => {
    return skillFiles
      .filter((f) => skillMetas.has(f.id))
      .map((f) => {
        const meta = skillMetas.get(f.id)!;
        return {
          id: f.id,
          title: meta.title,
          description: meta.description,
          availableForIngest: meta.availableForIngest,
          modifiedAt: f.modifiedTime,
          systemSkillId: meta.systemSkillId,
          language: meta.language,
        };
      })
      .sort((a, b) => {
        // システムスキルを上に表示
        const aSys = a.systemSkillId ? 0 : 1;
        const bSys = b.systemSkillId ? 0 : 1;
        if (aSys !== bSys) return aSys - bSys;
        return new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
      });
  }, [skillFiles, skillMetas]);

  const filtered = useMemo(() => {
    if (!searchQuery) return skillEntries;
    const q = searchQuery.toLowerCase();
    return skillEntries.filter(
      (e) => e.title.toLowerCase().includes(q) || e.description.toLowerCase().includes(q),
    );
  }, [skillEntries, searchQuery]);

  const handleDelete = async (e: React.MouseEvent, skillId: string) => {
    e.stopPropagation();
    if (deletingId) return;
    setDeletingId(skillId);
    try {
      await onDeleteSkill(skillId);
    } finally {
      setDeletingId(null);
    }
  };

  const handleReset = async (e: React.MouseEvent, skillId: string) => {
    e.stopPropagation();
    if (!onResetSystemSkill) return;
    if (!confirm(t("skill.resetConfirm"))) return;
    await onResetSystemSkill(skillId);
  };

  return (
    <div className="flex flex-col h-full">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <Breadcrumb items={[
          { label: t("nav.home"), onClick: onBack },
          { label: t("sidebar.skill") },
        ]} />
        <div className="flex items-center gap-2">
          <Wrench size={16} className="text-primary" />
          <span className="text-xs text-muted-foreground">({filtered.length})</span>
        </div>
        <div className="flex-1" />
        <button
          onClick={onNewSkill}
          className="flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-border bg-background hover:bg-muted transition-colors"
        >
          <Plus size={12} />
          <span>{t("skill.new")}</span>
        </button>
        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("common.search")}
            className="pl-7 pr-3 py-1 text-xs rounded border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-48"
          />
        </div>
      </div>

      {/* リスト */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-xs text-muted-foreground gap-2">
            <Wrench size={24} className="opacity-30" />
            <span>
              {searchQuery ? t("skill.noMatching") : t("skill.empty")}
            </span>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((entry) => (
              // 行の中に編集・削除ボタンを置くため、行自体は button にしない（button 入れ子は HTML 仕様違反）
              <div
                key={entry.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpenSkill(entry.id)}
                onDoubleClick={() => onOpenSkillFull?.(entry.id)}
                onKeyDown={(e) => {
                  // 内側のボタンからバブリングしてきたキー入力では行を開かない
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpenSkill(entry.id);
                  }
                }}
                className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors group cursor-pointer"
              >
                <div className="flex items-start gap-3">
                  <Wrench size={14} className="text-primary mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground truncate">
                        {entry.title}
                      </span>
                      {entry.systemSkillId && (
                        <span title={t("skill.systemBadgeTooltip")} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] bg-muted text-muted-foreground">
                          <Lock size={9} />
                          <span>{t("skill.systemBadge")}</span>
                        </span>
                      )}
                      {entry.language && (
                        <span title={t("skill.languageTooltip", { language: entry.language === "ja" ? t("skill.langJa") : t("skill.langEn") })} className="px-1.5 py-0.5 rounded text-[9px] bg-muted text-muted-foreground uppercase">
                          {entry.language}
                        </span>
                      )}
                      {entry.availableForIngest && (
                        <span title={t("skill.autoApplyBadge")}><Zap size={12} className="text-amber-500 shrink-0" /></span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-muted-foreground">
                        {formatDate(entry.modifiedAt)}
                      </span>
                      {entry.description && (
                        <span className="text-[10px] text-muted-foreground truncate">
                          {entry.description}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); onEditSkill(entry.id); }}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-all p-1"
                      title={t("skill.editTooltip")}
                    >
                      <Pencil size={14} />
                    </button>
                    {entry.systemSkillId ? (
                      onResetSystemSkill && (
                        <button
                          onClick={(e) => handleReset(e, entry.id)}
                          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded border border-border bg-background text-[10px]"
                          title={t("skill.resetTooltip")}
                        >
                          <RotateCcw size={12} />
                          <span>{t("skill.resetToDefault")}</span>
                        </button>
                      )
                    ) : (
                      <button
                        onClick={(e) => handleDelete(e, entry.id)}
                        disabled={deletingId === entry.id}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-1"
                        title={t("common.delete")}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
