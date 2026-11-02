// 個人テンプレートの編集画面の帯（エディタの上に出す）。
// スキルの帯（SkillBanner）と同じ置き場所・同じ高さにそろえ、「いまノートではなく
// テンプレートを直している」ことと、編集を終える・取り消す操作をここにまとめる。
//
// 保存は自動（ノートと同じ 3 秒の自動保存）。明示の保存ボタンを置かない理由:
// サイドバーなどから別の画面へ移ったときに、押し忘れた編集が黙って消えるのを避けるため。
// 取り消したいときは「編集前に戻す」で、開いた時点の中身へ戻す。

import { LayoutTemplate, RotateCcw, Check } from "lucide-react";
import { useT } from "../../i18n";

type Props = {
  /** 開いた時点の中身へ戻す。確認は呼び出し側 */
  onRevert: () => void;
  /** 編集を終えて元の画面へ戻る */
  onDone: () => void;
  /** 戻す・終える処理の途中（ボタンを押せなくする） */
  busy?: boolean;
};

export function TemplateEditBanner({ onRevert, onDone, busy = false }: Props) {
  const t = useT();
  return (
    <div
      data-testid="template-edit-banner"
      className="flex items-center gap-2 px-3 py-1.5 bg-muted/40 border-b border-border text-xs"
    >
      <LayoutTemplate size={12} className="shrink-0 text-muted-foreground" />
      <span className="font-medium text-foreground shrink-0">{t("template.edit.badge")}</span>
      <span className="min-w-0 truncate text-muted-foreground" title={t("template.edit.hint")}>
        {t("template.edit.hint")}
      </span>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onRevert}
        disabled={busy}
        data-testid="template-edit-revert"
        className="flex shrink-0 items-center gap-1 rounded px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
      >
        <RotateCcw size={11} />
        <span>{t("template.edit.revert")}</span>
      </button>
      <button
        type="button"
        onClick={onDone}
        disabled={busy}
        data-testid="template-edit-done"
        className="flex shrink-0 items-center gap-1 rounded border border-border bg-background px-2 py-1 font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
      >
        <Check size={11} />
        <span>{t("template.edit.done")}</span>
      </button>
    </div>
  );
}
