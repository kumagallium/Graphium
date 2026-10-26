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

import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useId, useState, type ReactNode } from "react";

const STORAGE_PREFIX = "graphium-settings-group:";

/**
 * まとまり（畳む束も、畳まない「モデルの割り当て」なども）の見出しと中身の見せ方（2026-10-27 合意）。
 * 見出しと項目が同じ大きさ・同じ字下げだと、どこまでが 1 つのまとまりか目がすべる。
 * 見出しを項目（SettingSection の text-xs）より一段大きくし、中の項目を字下げする
 */
export const SETTINGS_BLOCK_TITLE_CLASS = "text-sm font-semibold text-foreground";
export const SETTINGS_BLOCK_BODY_CLASS = "pl-4";

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
    <div className="border-t border-border pt-4">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={bodyId}
        className="w-full text-left group"
      >
        <span className={`flex items-center gap-1 ${SETTINGS_BLOCK_TITLE_CLASS}`}>
          <span className="shrink-0 -ml-0.5 text-muted-foreground">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          <span className="flex-1">{title}</span>
        </span>
        {summary && !open && (
          <span className="block text-xs text-muted-foreground mt-0.5 ml-4">{summary}</span>
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
