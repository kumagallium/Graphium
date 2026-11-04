// 設定画面の「束」。複数のセクションをまとめて畳む。
//
// 設定はどれも同じ見出しの重さで縦に積まれていて、毎日触るもの（言語・保存先）と
// 一生触らないもの（索引の作り直し・MCP・単価）が同格に見えていた。この部品は
// 後者を既定で畳み、開いた人にだけ見せる。
//
// 畳んだ状態でも summary で「中に何があるか」を示す。閉じた見出しだけだと
// 探しものがそこにあるか分からず、結局すべて開くことになるため。
//
// 開閉はブラウザに覚えさせる（毎回開く人が毎回開き直さずに済む）。
// サイドバーの CollapsibleSection とは見た目も置き場所も違うので別部品にしてある。

import { ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useId, useState, type ReactNode } from "react";

const STORAGE_PREFIX = "graphium-settings-group:";

/**
 * まとまり（畳む束も、畳まない「モデルの割り当て」なども）の見出しと中身の見せ方（2026-10-27 合意）。
 * 見出しと項目が同じ大きさ・同じ字下げだと、どこまでが 1 つのまとまりか目がすべる。
 * 見出しを項目（SettingSection の text-xs）より一段大きくし、中の項目を字下げする。
 *
 * 見出しは薄い背景色の帯にする（2026-11-04 合意）。まとまりの上の区切り線とカードの枠線が
 * 重なって画面が線だらけに見えていたので、区切り線は引かず、帯が区切りを兼ねる。
 * 見出しの横にボタンを並べる行（登録済みモデル）は、行に BAND・見出しに TEXT を当てる
 */
export const SETTINGS_BLOCK_BAND_CLASS = "rounded-md bg-muted px-3 py-1.5";
export const SETTINGS_BLOCK_TITLE_TEXT_CLASS = "text-sm font-semibold text-foreground";
export const SETTINGS_BLOCK_TITLE_CLASS = `${SETTINGS_BLOCK_BAND_CLASS} ${SETTINGS_BLOCK_TITLE_TEXT_CLASS}`;
export const SETTINGS_BLOCK_BODY_CLASS = "pl-4";

/**
 * 項目（SettingSection や直書きの text-xs 見出し）の説明と中身の字下げ（2026-11-02 合意）。
 * まとまりの中だけ字下げしていたら、中見出し「モデル」「言語」と選択肢の頭が同じ列に並び、
 * どこまでがその項目か目がすべった。見出しの後ろはどの段でも一段下げる、の 1 つの決まりにする。
 * カード（SETTINGS_CARD_CLASS の面）の中の見出しは、面が範囲を示すので対象外
 */
export const SETTINGS_ITEM_BODY_CLASS = "pl-4";

/**
 * 設定の中のカード（2026-11-04 合意）。枠線ではなく面で囲む。
 * CARD はまとまりの中に直接置くもの、INNER_CARD は CARD の中にさらに置くもの（白い面）。
 * 入力欄・ボタンの枠はそのまま（押せる・書ける印なので）
 */
export const SETTINGS_CARD_CLASS = "rounded-lg bg-muted/60";
export const SETTINGS_INNER_CARD_CLASS = "rounded-lg bg-card";

/**
 * 見出しの左に置くアイコンの寸法（2026-10-28 合意）。12px + gap-1 でちょうど pl-4 になるので、
 * アイコンだけが左にはみ出し、見出しの文字・説明・中身の頭が 1 本に揃う。
 * 束の開閉シェブロン（下の SettingsGroup）も同じ寸法
 */
export const SETTINGS_HEADING_ICON_SIZE = 12;

/** まとまりの見出し（アイコン付きも可）。説明と中身は SETTINGS_BLOCK_BODY_CLASS で字下げする */
export function SettingsBlockTitle({
  icon: Icon,
  className = "",
  children,
}: {
  icon?: LucideIcon;
  className?: string;
  children: ReactNode;
}) {
  return (
    <h3 className={`flex items-center gap-1 ${SETTINGS_BLOCK_TITLE_CLASS} ${className}`}>
      {Icon && <Icon size={SETTINGS_HEADING_ICON_SIZE} className="shrink-0 text-muted-foreground" />}
      {children}
    </h3>
  );
}

function readOpenState(storageKey: string, defaultOpen: boolean): boolean {
  try {
    const v = localStorage.getItem(STORAGE_PREFIX + storageKey);
    if (v === "1") return true;
    if (v === "0") return false;
    return defaultOpen;
  } catch {
    return defaultOpen;
  }
}

function writeOpenState(storageKey: string, open: boolean): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + storageKey, open ? "1" : "0");
  } catch {
    /* プライベートモード等では覚えないだけで、開閉自体は動く */
  }
}

/** 束と同じ保存先で開閉を覚える。見出しに別のボタンを並べたい箇所（登録済みモデル）用 */
export function usePersistentOpen(storageKey: string, defaultOpen: boolean) {
  const [open, setOpen] = useState<boolean>(() => readOpenState(storageKey, defaultOpen));
  useEffect(() => {
    writeOpenState(storageKey, open);
  }, [storageKey, open]);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  return [open, toggle] as const;
}

export type SettingsGroupProps = {
  /** 開閉状態の保存キー（"advanced" など。prefix は内部で付ける） */
  storageKey: string;
  /** 束の見出し */
  title: string;
  /** 畳んだままでも見える 1 行。中に何があるかを書く */
  summary?: string;
  /** 既定で開くか（上級者向けの束は false のまま） */
  defaultOpen?: boolean;
  children: ReactNode;
};

export function SettingsGroup({
  storageKey,
  title,
  summary,
  defaultOpen = false,
  children,
}: SettingsGroupProps) {
  const [open, toggle] = usePersistentOpen(storageKey, defaultOpen);
  const bodyId = useId();

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={bodyId}
        className="w-full text-left group"
      >
        <span className={`flex items-center gap-1 ${SETTINGS_BLOCK_TITLE_CLASS} group-hover:bg-accent transition-colors`}>
          <span className="shrink-0 text-muted-foreground">
            {open ? <ChevronDown size={SETTINGS_HEADING_ICON_SIZE} /> : <ChevronRight size={SETTINGS_HEADING_ICON_SIZE} />}
          </span>
          <span className="flex-1">{title}</span>
        </span>
        {/* 要約は帯の文字（px-3 + シェブロン 12px + gap-1 = 28px）の頭に揃える */}
        {summary && !open && (
          <span className="block text-xs text-muted-foreground mt-1 ml-7">{summary}</span>
        )}
      </button>
      {open && (
        <div id={bodyId} className={`space-y-5 mt-4 ${SETTINGS_BLOCK_BODY_CLASS}`}>
          {children}
        </div>
      )}
    </div>
  );
}
