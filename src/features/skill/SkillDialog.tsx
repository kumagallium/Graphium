// Skill 作成 / 編集ダイアログ
// mode="create" で新規作成、mode="edit" で既存 Skill のメタ情報（説明・Ingest 自動適用・
// 適用言語・タイトル）を後から修正する。本文（プロンプトテンプレート）はエディタ側で編集する。

import { useState } from "react";
import { X } from "lucide-react";
import { useT } from "../../i18n";

export type SkillFormValues = {
  title: string;
  description: string;
  availableForIngest: boolean;
  /** 適用言語。undefined = 全言語に適用 */
  language?: "ja" | "en";
};

type Props = {
  mode: "create" | "edit";
  /** 編集時の初期値。create のときは未指定でよい。 */
  initial?: SkillFormValues;
  onClose: () => void;
  onSubmit: (values: SkillFormValues) => void;
};

export function SkillDialog({ mode, initial, onClose, onSubmit }: Props) {
  const t = useT();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [availableForIngest, setAvailableForIngest] = useState(initial?.availableForIngest ?? true);
  // 適用言語: "all"（全言語）= language 未指定
  const [language, setLanguage] = useState<"all" | "ja" | "en">(initial?.language ?? "all");

  const isEdit = mode === "edit";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit({
      title: title.trim(),
      description: description.trim(),
      availableForIngest,
      language: language === "all" ? undefined : language,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background border border-border rounded-lg shadow-lg w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">{isEdit ? "Edit Skill" : "New Skill"}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Literature Reviewer"
              className="w-full px-3 py-2 text-sm rounded border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this skill do? (one line)"
              className="w-full px-3 py-2 text-sm rounded border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              {t("skill.descriptionHelp")}
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">
              {t("skill.languageLabel")}
            </label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as "all" | "ja" | "en")}
              className="w-full px-3 py-2 text-sm rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="all">{t("skill.langAll")}</option>
              <option value="ja">{t("skill.langJa")}</option>
              <option value="en">{t("skill.langEn")}</option>
            </select>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {t("skill.languageHelp")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="ingest-toggle"
              checked={availableForIngest}
              onChange={(e) => setAvailableForIngest(e.target.checked)}
              className="rounded border-border"
            />
            <label htmlFor="ingest-toggle" className="text-xs text-foreground">
              {t("skill.autoApplyLabel")}
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim()}
              className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {isEdit ? "Save" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
