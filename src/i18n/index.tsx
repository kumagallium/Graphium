// i18n 基盤
// 軽量カスタム実装: React Context + JSON 辞書

import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { en } from "./en";
import { ja } from "./ja";
import { ko } from "./ko";
import { toGenerationLanguage, type GenerationLanguage } from "../lib/language";

export type Locale = "en" | "ja" | "ko";

/** 辞書を持つすべてのロケール（表示順）。選べるかどうかは isLocaleEnabled() で決まる */
export const SUPPORTED_LOCALES: readonly Locale[] = ["en", "ja", "ko"];

/** 言語の選択肢に出す名前（その言語自身の表記） */
export const LOCALE_DISPLAY_NAMES: Record<Locale, string> = {
  en: "English",
  ja: "日本語",
  ko: "한국어",
};

const STORAGE_KEY = "graphium_locale";

const dictionaries: Record<Locale, Record<string, string>> = { en, ja, ko };

// ── 公開するロケール ──
// 翻訳が揃うまでのロケールは既定で無効にする。無効なロケールは自動検出・保存値の復元・
// 言語の選択肢・切替（setLocale / syncLocale）のどれからも有効にならない。
// 開発ビルドで VITE_ENABLE_PREVIEW_LOCALES=true のときだけ試験的に有効にできる。

/** 誰でも選べるロケール */
const RELEASED_LOCALES: ReadonlySet<Locale> = new Set<Locale>(["en", "ja"]);

function previewLocalesEnabled(): boolean {
  // MCP サーバー（Node）からも import されるので、import.meta.env が無い場合がある。
  // Vite は `import.meta.env` という字面を置き換えるので、キャストで包まずにそのまま書く
  const env = import.meta.env as ImportMetaEnv | undefined;
  return env?.DEV === true && env?.VITE_ENABLE_PREVIEW_LOCALES === "true";
}

function isSupportedLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** 現在の公開方針でこのロケールを使えるか */
export function isLocaleEnabled(value: string): value is Locale {
  if (!isSupportedLocale(value)) return false;
  return RELEASED_LOCALES.has(value) || previewLocalesEnabled();
}

/** 言語の選択肢に出すロケール（表示順） */
export function getEnabledLocales(): Locale[] {
  return SUPPORTED_LOCALES.filter((l) => isLocaleEnabled(l));
}

// 保存値 → ブラウザの言語 → en の順に決める
function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      if (isLocaleEnabled(saved)) return saved;
      // 辞書はあるが今は無効なロケール（公開前の ko など）は en で表示する。
      // 保存値は消さない（公開後や開発時の試験有効化でそのまま復元できるように）
      if (isSupportedLocale(saved)) return "en";
    }
    const browserLang = navigator.language.toLowerCase().split("-")[0];
    if (browserLang && isLocaleEnabled(browserLang)) return browserLang;
  } catch {
    // テスト環境など localStorage/navigator が利用不可の場合
  }
  return "en";
}

/** <html lang> を現在のロケールに合わせる（支援技術・ブラウザの言語判定用） */
function applyDocumentLang(locale: Locale) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
}

/** 辞書引き + {param} 置換。Context 版と Context 外版で共有する。 */
function translate(
  locale: Locale,
  key: string,
  params?: Record<string, string>,
): string {
  let text = dictionaries[locale][key] ?? dictionaries.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, v);
    }
  }
  return text;
}

// ── ロケールの現在値ストア ──
// React Context とは別に、モジュールスコープに現在のロケールを持つ。
// BlockNote のカスタムブロック（createReactBlockSpec の render）や
// スラッシュメニュー項目は Context を辿れない場所で描画され得るため、
// そこから翻訳するには Context 非依存の入口が要る。
//
// ただし「値を読めるだけ」では言語切替時に古い文字列が残る。購読者に
// 変更を通知して、Context の外にいるコンポーネントも再レンダーさせる。

let currentLocale: Locale = detectLocale();
applyDocumentLang(currentLocale);
const localeListeners = new Set<() => void>();

/**
 * Context 外用: 現在のロケールを更新し、購読者に通知する（LocaleProvider が呼ぶ）。
 * 無効なロケールへの切替は無視する。
 */
export function syncLocale(locale: Locale) {
  if (!isLocaleEnabled(locale)) return;
  if (currentLocale === locale) return;
  currentLocale = locale;
  applyDocumentLang(locale);
  // 通知中に購読解除されてもイテレーションを壊さないようコピーしてから回す
  for (const listener of [...localeListeners]) listener();
}

/** Context 外用: 現在のロケール取得 */
export function getLocale(): Locale {
  return currentLocale;
}

/**
 * 現在の UI 言語で AI に生成させるときの出力言語（要約・Wiki 化・チャット・点検など）。
 * 生成に未対応の UI 言語は en に寄せる（src/lib/language.ts）。
 * 翻訳の目的言語には使わない（翻訳は getLocale() をそのまま渡す）。
 */
export function getGenerationLanguage(): GenerationLanguage {
  return toGenerationLanguage(currentLocale);
}

function subscribeLocale(listener: () => void): () => void {
  localeListeners.add(listener);
  return () => {
    localeListeners.delete(listener);
  };
}

/**
 * ロケール変更時に再レンダーさせるフック。
 *
 * LocaleProvider の Context を必要としないので、BlockNote のカスタムブロックや
 * インラインコンテンツの render のように React ツリー外でも呼ばれ得る場所で使える。
 * 戻り値を使わなくてよい（モジュールスコープの t() が新しいロケールで再評価される）。
 *
 * 使い方: モジュールスコープの t() を呼ぶブロックコンポーネントの先頭で 1 回呼ぶ。
 * 子コンポーネントは親の再レンダーに追従するので、最上位で 1 回で足りる。
 */
export function useLocaleSubscription(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

/** Context 外用: 翻訳関数 */
export function t(key: string, params?: Record<string, string>) {
  return translate(currentLocale, key, params);
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
  // Context 内の値も同じストアから引く。State を別に持つと Context 内外で
  // ロケールがずれて、片方だけ古い言語のまま残る。
  const locale = useLocaleSubscription();

  const setLocale = useCallback((newLocale: Locale) => {
    // 無効なロケールへの切替要求は無視し、保存もしない（表示と保存値がずれないように）
    if (!isLocaleEnabled(newLocale)) return;
    syncLocale(newLocale);
    localStorage.setItem(STORAGE_KEY, newLocale);
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string>) => translate(locale, key, params),
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

// ── ラベル表示名変換 ──
// 内部キー（"procedure" 等）をロケールに応じた表示名に変換
// ユーザーがカスタム表示名を設定している場合はそちらを優先

import { getCustomLabels } from "../features/settings/store";
import { normalizeLabel } from "../features/context-label/labels";

// 内部キー → i18n キー（ブラケット付き表示名）
const LABEL_DISPLAY_MAP: Record<string, string> = {
  // コアラベル: Section 層
  procedure: "label.step.bracketed",
  // コアラベル: Phase 層
  plan: "label.plan.bracketed",
  result: "label.result.bracketed",
  // コアラベル: Inline 層
  material: "label.material.bracketed",
  tool: "label.tool.bracketed",
  attribute: "label.attr.bracketed",
  output: "label.output.bracketed",
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

/** Callout の種類（variant）の表示名を返す。 */
export function getCalloutVariantLabel(variant: string): string {
  return t(`callout.variant.${variant}`);
}
