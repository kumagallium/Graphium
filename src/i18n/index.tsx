// i18n 基盤
// 軽量カスタム実装: React Context + JSON 辞書

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { en } from "./en";
import { ja } from "./ja";

export type Locale = "en" | "ja";

const STORAGE_KEY = "graphium_locale";

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
// 内部キー（"procedure" 等）をロケールに応じた表示名に変換
// ユーザーがカスタム表示名を設定している場合はそちらを優先

import { getCustomLabels } from "../features/settings/store";
import { normalizeLabel } from "../features/context-label/labels";

// 内部キー → i18n キー（ブラケット付き表示名）
const LABEL_DISPLAY_MAP: Record<string, string> = {
  // コアラベル
  procedure: "label.step.bracketed",
  material: "label.material.bracketed",
  tool: "label.tool.bracketed",
  attribute: "label.attr.bracketed",
  result: "label.result.bracketed",
  // 構造ラベル
  "prev-procedure": "label.prevStep.bracketed",
  // フリーラベル例（内部キーは "free.xxx"）
  "free.purpose": "label.free.purpose",
  "free.discussion": "label.free.discussion",
  "free.question": "label.free.question",
  "free.evidence": "label.free.evidence",
  "free.background": "label.free.background",
  "free.reference": "label.free.reference",
  "free.impression": "label.free.impression",
};

/** 内部ラベルキーを表示名に変換（カスタム名があればそちらを優先） */
export function getDisplayLabel(internalLabel: string): string {
  // 旧データ・外部入力で渡された表示文字列は内部キーに寄せる
  const key = normalizeLabel(internalLabel);

  // カスタム表示名があればそちらを返す（キーは内部キー）
  const custom = getCustomLabels();
  if (custom[key]) return `[${custom[key]}]`;

  const i18nKey = LABEL_DISPLAY_MAP[key];
  if (i18nKey) return t(i18nKey);
  // コアラベル以外はそのまま返す（フリーラベル文字列など）
  return internalLabel;
}

/** 括弧なしの表示名を取得 */
export function getDisplayLabelName(internalLabel: string): string {
  const key = normalizeLabel(internalLabel);
  const custom = getCustomLabels();
  if (custom[key]) return custom[key];

  const display = getDisplayLabel(internalLabel);
  // [xxx] → xxx
  const m = display.match(/^\[(.+)\]$/);
  return m ? m[1] : display;
}
