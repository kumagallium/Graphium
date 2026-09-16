// 設定画面のトグル 1 行。
//
// 機能のオン・オフは、どれも「トグル + 2〜3 行の説明」で書かれていた。説明が
// 常に開いているとトグル 3 つで画面が埋まるので、SettingSection と同じ二段に分ける:
// summary は常に見え、条件や例外は「くわしく」の中に入る。
//
// トグル自体のマークアップ（w-8 h-[18px] のスイッチ）は設定モーダルにあったものを
// そのまま持ってきている。見た目を変えるのはここの目的ではない。

import { ChevronDown, ChevronRight } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { useLocale } from "../../i18n";

export type SettingToggleProps = {
  checked: boolean;
  onChange: () => void;
  /** トグルの名前 */
  label: string;
  /** 常に見える 1 行 */
  summary?: ReactNode;
  /** 「くわしく」で開く補足。渡さなければトグルを出さない */
  details?: ReactNode;
  /** トグルの下に置く追加のコントロール（オンのときだけ出す条件は呼び出し側で持つ） */
  children?: ReactNode;
};

export function SettingToggle({
  checked,
  onChange,
  label,
  summary,
  details,
  children,
}: SettingToggleProps) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const detailsId = useId();

  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onChange}
          role="switch"
          aria-checked={checked}
          aria-label={label}
          className={`shrink-0 inline-flex items-center rounded-full border border-border transition-colors w-8 h-[18px] ${checked ? "bg-primary" : "bg-input"}`}
        >
          <span
            className="block w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform duration-200"
            style={{ transform: checked ? "translateX(15px)" : "translateX(1px)" }}
          />
        </button>
        <label className="text-sm font-medium text-foreground flex-1 min-w-0">{label}</label>
        {details && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={detailsId}
            className="shrink-0 flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            {open ? t("settings.detailsHide") : t("settings.detailsShow")}
          </button>
        )}
      </div>

      {summary && <p className="text-xs text-muted-foreground mt-1.5 ml-10">{summary}</p>}

      {details && open && (
        <div id={detailsId} className="text-xs text-muted-foreground mt-1.5 ml-10 pl-2 border-l border-border">
          {details}
        </div>
      )}

      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}
