// 設定画面の 1 セクション。
//
// 設定モーダルは説明文（help）を 115 箇所すべて常時展開していて、初めて開いた人が
// 「読まされる壁」に当たっていた。この部品は説明を 2 段に分ける:
//
//   summary — 常に見える 1 行。ここだけ読めば何の設定か分かる長さに保つ
//   details — 「くわしく」を押したときだけ出る。条件・注意・例外はすべてこちら
//
// summary を隠さないのは、全部畳むと今度は「何の設定か分からない箱」が並ぶため。
// 読み書きに時間がかかる人ほど、開く操作を強いられると設定にたどり着けない。

import { ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { useLocale } from "../../i18n";
import {
  SETTINGS_BLOCK_BAND_CLASS,
  SETTINGS_BLOCK_BODY_CLASS,
  SETTINGS_BLOCK_TITLE_TEXT_CLASS,
  SETTINGS_HEADING_ICON_SIZE,
  SETTINGS_ITEM_BODY_CLASS,
} from "./SettingsGroup";

export type SettingSectionProps = {
  /** 見出しの左に置くアイコン（省略可） */
  icon?: LucideIcon;
  /** 見出し */
  title: string;
  /** 常に見える 1 行の要約 */
  summary?: ReactNode;
  /** 「くわしく」で開く補足。渡さなければトグル自体を出さない */
  details?: ReactNode;
  /** 初期状態で details を開く（移行期に「前と同じ情報量」で見せたいとき用） */
  defaultOpen?: boolean;
  /** コントロール本体 */
  children?: ReactNode;
  /**
   * タブの一番上の段に直接置くとき true。見出しをまとまりと同じ帯（SETTINGS_BLOCK_*）にする。
   * 束（SettingsGroup）やまとまりの中に置く項目は false のまま（帯の中に帯を重ねない）
   */
  band?: boolean;
};

export function SettingSection({
  icon: Icon,
  title,
  summary,
  details,
  defaultOpen = false,
  children,
  band = false,
}: SettingSectionProps) {
  const { t } = useLocale();
  const [open, setOpen] = useState(defaultOpen);
  const detailsId = useId();

  // 説明と中身は見出しの後ろとして常に一段下げる（SETTINGS_ITEM_BODY_CLASS）。
  // アイコン付きのときは 12px + gap-1 がちょうどこの字下げになり、見出しの文字・説明・中身の頭が揃う
  // 帯のときは AI タブのまとまり（SettingsBlockTitle）と同じ帯・文字・字下げにそろえる
  const indent = band ? SETTINGS_BLOCK_BODY_CLASS : SETTINGS_ITEM_BODY_CLASS;
  const align = band ? "items-center" : "items-start";
  const titleClass = band ? SETTINGS_BLOCK_TITLE_TEXT_CLASS : "text-xs font-semibold text-foreground";

  return (
    <div>
      <div className={`flex ${align} gap-1.5 ${band ? SETTINGS_BLOCK_BAND_CLASS : ""}`}>
        <div className={`flex flex-1 min-w-0 ${align} gap-1`}>
          {Icon && <Icon size={SETTINGS_HEADING_ICON_SIZE} className={`text-muted-foreground shrink-0 ${band ? "" : "mt-0.5"}`} />}
          <h3 className={`${titleClass} flex-1 min-w-0`}>{title}</h3>
        </div>
        {details && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={detailsId}
            className={`shrink-0 ${band ? "" : "-mt-px"} flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors`}
          >
            {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            {open ? t("settings.detailsHide") : t("settings.detailsShow")}
          </button>
        )}
      </div>

      {summary && (
        <p className={`text-xs text-muted-foreground ${band ? "mt-1.5" : "mt-1"} ${indent}`}>{summary}</p>
      )}

      {details && open && (
        <div className={indent}>
          <div id={detailsId} className="text-xs text-muted-foreground mt-1.5 pl-2 border-l border-border">
            {details}
          </div>
        </div>
      )}

      {children && <div className={`mt-2 ${indent}`}>{children}</div>}
    </div>
  );
}
