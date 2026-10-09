// 「テンプレートとして保存」ダイアログ（個人テンプレート）。
// 見た目と作法は ShareTemplateDialog に合わせる（名前＋説明、開くたびに初期化、
// 本文は押した時点で組み立てる）。トリガーは持たない（ノートの ⋯ メニューが開閉を持つ）。

import { DIALOG_LAYER } from "@/ui/z-layers";
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { useT } from "../../i18n";
import type { GraphiumPage } from "../../lib/document-types";
import type { StepAttributes } from "../context-label/label-attributes";
import { saveUserTemplate, type UserTemplateRecord } from "./user-template-store";

export type SaveTemplateDialogProps = {
  open: boolean;
  /** タイトル入力の初期値（既定はノート題名） */
  defaultTitle: string;
  /**
   * 保存対象のページを組み立てる。null を返した場合は保存しない。
   * attributes は手順の連動属性。ページに保存されない実行時の状態なので、
   * ラベルストアを持つ呼び出し側から受け取る。
   */
  resolveSource: () => Promise<{
    page: GraphiumPage;
    attributes?: [string, StepAttributes][];
  } | null>;
  onClose: () => void;
  /** 保存成功後 */
  onSaved?: (record: UserTemplateRecord) => void;
};

export function SaveTemplateDialog({
  open,
  defaultTitle,
  resolveSource,
  onClose,
  onSaved,
}: SaveTemplateDialogProps) {
  const t = useT();
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 開くたびに入力を初期化する（前回の説明が残っていると別テンプレートに紛れ込む）
  useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle);
    setDescription("");
    setError(null);
  }, [open, defaultTitle]);

  const handleSave = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const source = await resolveSource();
      if (!source) {
        setError(t("template.save.noPage"));
        return;
      }
      const record = await saveUserTemplate({
        title,
        description,
        page: source.page,
        attributes: source.attributes,
      });
      onSaved?.(record);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [resolveSource, title, description, onSaved, onClose, t]);

  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 ${DIALOG_LAYER} flex items-center justify-center bg-black/40`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="bg-background border border-border rounded-lg shadow-2xl w-[90%] max-w-md p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-1">
            {t("template.save.dialog.title")}
          </h3>
          <p className="text-xs text-muted-foreground">{t("template.save.dialog.help")}</p>
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground block mb-1">
            {t("template.save.dialog.titleLabel")}
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
            className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background text-foreground focus:border-primary focus:outline-none"
          />
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground block mb-1">
            {t("template.save.dialog.descLabel")}
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
            rows={3}
            className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background text-foreground focus:border-primary focus:outline-none resize-none"
          />
        </div>
        {error && (
          <p className="text-xs text-red-500 flex items-start gap-1">
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            <span className="break-all">{error}</span>
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={busy || !title.trim()}
            className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {busy ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                {t("template.save.saving")}
              </>
            ) : (
              t("template.save.dialog.save")
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
