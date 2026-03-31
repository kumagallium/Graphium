// i18n 基盤
// 軽量カスタム実装: React Context + JSON 辞書

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { en } from "./en";
import { ja } from "./ja";

export type Locale = "en" | "ja";

const STORAGE_KEY = "provnote_locale";

const dictionaries: Record<Locale, Record<string, string>> = { en, ja };

// ブラウザのデフォルトロケールを検出
function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "ja") return saved;
    const browserLang = navigator.language.toLowerCase();
    if (browserLang.startsWith("ja")) return "ja";
  } catch {
    // テスト環境など localStorage/navigator が利用不可の場合
  }
  return "en";
}

// ── Context ──

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string>) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

// ── Provider ──

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, _setLocale] = useState<Locale>(detectLocale);

  const setLocale = useCallback((newLocale: Locale) => {
    _setLocale(newLocale);
    syncLocale(newLocale);
    localStorage.setItem(STORAGE_KEY, newLocale);
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string>) => {
      let text = dictionaries[locale][key] ?? dictionaries.en[key] ?? key;
      // {param} 形式のプレースホルダーを置換
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          text = text.replace(`{${k}}`, v);
        }
      }
      return text;
    },
    [locale],
  );

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  );
}

// ── Hooks ──

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}

/** 翻訳関数のみ取得するショートカット */
export function useT() {
  return useLocale().t;
}

// ── Context 外で使う翻訳ユーティリティ ──
// BlockNote のスラッシュメニュー等、React ツリー外で翻訳が必要な場合に使用

let currentLocale: Locale = detectLocale();

/** Context 外用: 現在のロケールを更新（LocaleProvider が呼ぶ） */
export function syncLocale(locale: Locale) {
  currentLocale = locale;
}

/** Context 外用: 翻訳関数 */
export function t(key: string, params?: Record<string, string>) {
  let text = dictionaries[currentLocale][key] ?? dictionaries.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, v);
    }
  }
  return text;
}

/** Context 外用: 現在のロケール取得 */
export function getLocale(): Locale {
  return currentLocale;
}

// ── ラベル表示名変換 ──
// 内部キー（[手順] 等）をロケールに応じた表示名に変換

const LABEL_DISPLAY_MAP: Record<string, string> = {
  "[手順]": "label.step.bracketed",
  "[使用したもの]": "label.used.bracketed",
  "[属性]": "label.attr.bracketed",
  "[結果]": "label.result.bracketed",
  "[前手順]": "label.prevStep.bracketed",
};

/** 内部ラベルキーを表示名に変換 */
export function getDisplayLabel(internalLabel: string): string {
  const key = LABEL_DISPLAY_MAP[internalLabel];
  if (key) return t(key);
  // コアラベル以外はそのまま返す（フリーラベル）
  return internalLabel;
}

/** 括弧なしの表示名を取得 */
export function getDisplayLabelName(internalLabel: string): string {
  const display = getDisplayLabel(internalLabel);
  // [xxx] → xxx
  const m = display.match(/^\[(.+)\]$/);
  return m ? m[1] : display;
}
