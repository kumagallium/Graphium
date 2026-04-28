// Landing-page-only i18n. Mirrors the app's storage key (`graphium_locale`) so
// the language choice is shared, but keeps the dictionary tiny so the LP bundle
// stays small.

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { createElement } from "react";

export type Locale = "en" | "ja";

const STORAGE_KEY = "graphium_locale";

export const en = {
  // Hero
  "hero.title": "Notes for the joy of discovery.",
  "hero.subtitle":
    "A block-based editor where your trial and error crystallizes into provenance — and AI extends from there.",
  "hero.tryOnline": "Try online",
  "hero.download": "Download desktop",
  "hero.starOnGithub": "Star on GitHub",

  // Problem
  "problem.heading": "Trial and error is where discoveries happen.",
  "problem.lead":
    "But the trail of how you got there usually evaporates. Decisions, dead ends, the messy middle — gone by the time anyone asks \"how did you get this result?\"",
  "problem.tagline": "Until the scattered pieces click into a single picture.",
  "problem.body":
    "Graphium is built around the belief that the steps matter as much as the answer. Every block you write can carry its own provenance, so the path from idea to result is preserved without changing how you write.",

  // How it thinks (3 pillars)
  "pillars.heading": "Three layers, one editor.",
  "pillars.sub": "Use as much — or as little — as you need.",

  "pillar.link.title": "Link",
  "pillar.link.body":
    "Write atomic notes and connect them with @ references. Small ideas linking until something clicks — Zettelkasten-style.",

  "pillar.trace.title": "Trace",
  "pillar.trace.body":
    "Add a context label (#procedure, #material, #result, …) and a block becomes part of a provenance graph (W3C PROV-DM). Use it where it matters — the rest stays plain text.",

  "pillar.extend.title": "Extend",
  "pillar.extend.body":
    "Connect an LLM and a second layer emerges — a wiki of concepts auto-generated from what you wrote, citing back to your source blocks.",

  // Built for trust
  "trust.heading": "Built for trust.",
  "trust.sub": "Open standards, open source, your storage.",
  "trust.standards.title": "Open standards",
  "trust.standards.body":
    "Provenance exports as W3C PROV-JSON-LD. Any tool that reads PROV-DM can read your data.",
  "trust.openSource.title": "Open source (MIT)",
  "trust.openSource.body":
    "Every line is on GitHub. Self-host with Docker, audit the code, send a PR.",
  "trust.storage.title": "Your storage",
  "trust.storage.body":
    "Notes are plain JSON files on your filesystem (desktop) or in your browser (web). Point the desktop app at a Google Drive / iCloud / Dropbox synced folder if you want sync — no extra OAuth required.",
  "trust.ai.title": "AI is opt-in",
  "trust.ai.body":
    "Without an LLM Graphium is just a clean linked-note editor. Plug one in to activate the Knowledge Layer.",
  "trust.reading.title": "Reading comfort",
  "trust.reading.body":
    "Atkinson Hyperlegible Next and Lexend ship as built-in fonts for dyslexia-aware reading.",

  // For everyone
  "everyone.heading": "For everyone who tinkers.",
  "everyone.sub":
    "The vocabulary is generic — labs, kitchens, workshops, codebases, classrooms.",
  "everyone.case.lab": "Researchers",
  "everyone.case.lab.body":
    "Experimental logs with full provenance. Procedures, materials, tools, attributes, results — labeled and linked.",
  "everyone.case.maker": "Cooks & makers",
  "everyone.case.maker.body":
    "Recipes that remember every variation. Why this version of the bread worked, and the four that didn't.",
  "everyone.case.engineer": "Engineers",
  "everyone.case.engineer.body":
    "Investigation notes that survive the next post-mortem. Hypotheses, evidence, decisions, all linked.",
  "everyone.case.student": "Students & writers",
  "everyone.case.student.body":
    "A second brain that links ideas across courses, books, and conversations — and explains itself when you come back.",

  // Get started
  "start.heading": "Get started.",
  "start.online.title": "Preview in browser",
  "start.online.body": "No install. Try the editor and PROV-DM labeling. Notes live in your browser (IndexedDB) — fine for kicking the tires, but the desktop app or a self-hosted Docker setup is what you want for the full experience (AI features, durable storage, cross-device sync).",
  "start.online.cta": "Open the preview",
  "start.desktop.title": "Desktop app",
  "start.desktop.body": "macOS Apple Silicon. Local files, AI features, optional cloud sync via OS-level Drive/iCloud/Dropbox folders.",
  "start.desktop.cta": "Download",
  "start.selfhost.title": "Self-host with Docker",
  "start.selfhost.body": "Notes stored on your server, accessible from any browser at the same URL. AI backend included.",
  "start.selfhost.cta": "Read the guide",

  // Footer
  "footer.builtBy": "Built by",
  "footer.repo": "GitHub",
  "footer.blog": "Blog",
  "footer.releases": "Releases",
  "footer.langToggle": "日本語",
} as const;

export const ja: Record<keyof typeof en, string> = {
  "hero.title": "発見する楽しさのためのノート。",
  "hero.subtitle":
    "あなたの試行錯誤が来歴（プロヴェナンス）として結晶化する、ブロックベースのエディタ。AI はその上で考えを広げていく。",
  "hero.tryOnline": "オンラインで試す",
  "hero.download": "デスクトップ版を入手",
  "hero.starOnGithub": "GitHub でスター",

  "problem.heading": "発見は、試行錯誤の中で起こる。",
  "problem.lead":
    "でも、そこに至る道筋は普通すぐ消える。決断、行き止まり、ぐちゃぐちゃの途中過程 — 「どうやってこの結果に辿り着いたの？」と聞かれる頃には、もう残っていない。",
  "problem.tagline": "散らばっていたピースが、一枚の絵として組み上がる瞬間まで。",
  "problem.body":
    "Graphium は、答えと同じくらい「過程」が大事だ、という考えで作られています。書いたブロックそれぞれが自分の来歴を持てるので、書き方を変えなくても、アイデアから結果までの道筋が残ります。",

  "pillars.heading": "3 つのレイヤー、ひとつのエディタ。",
  "pillars.sub": "必要な分だけ使えばいい。",

  "pillar.link.title": "つなぐ",
  "pillar.link.body":
    "原子ノートを書き、`@` 参照でつなぐ。小さなアイデアが繋がって、何かが噛み合う瞬間を待つ — Zettelkasten 流に。",

  "pillar.trace.title": "辿る",
  "pillar.trace.body":
    "コンテキストラベル（`#手順`、`#材料`、`#結果`…）を付ければ、そのブロックは来歴グラフ（W3C PROV-DM）の一部になる。必要な所だけに使えばいい — 残りはただのテキストのまま。",

  "pillar.extend.title": "広げる",
  "pillar.extend.body":
    "LLM をつなぐと、もう一層が立ち上がる — 書いたものから自動生成される概念 Wiki。元のブロックへの引用付きで。",

  "trust.heading": "信頼できる土台。",
  "trust.sub": "オープン標準、オープンソース、あなたのストレージ。",
  "trust.standards.title": "オープン標準",
  "trust.standards.body":
    "来歴は W3C PROV-JSON-LD で書き出せます。PROV-DM を読めるツールならどれでも読み込めます。",
  "trust.openSource.title": "オープンソース（MIT）",
  "trust.openSource.body":
    "コードは全部 GitHub にあります。Docker でセルフホストもでき、監査も PR も自由です。",
  "trust.storage.title": "あなたのストレージ",
  "trust.storage.body":
    "ノートはあなたのファイルシステム（デスクトップ版）またはブラウザ（Web 版）にプレーンな JSON で保存されます。Google Drive / iCloud / Dropbox の同期フォルダを保存先に指定すれば、追加の OAuth 連携なしでクラウド同期できます。",
  "trust.ai.title": "AI はオプトイン",
  "trust.ai.body":
    "LLM を繋がなくても、シンプルなリンクノートエディタとして動きます。繋ぐと Knowledge Layer が起動します。",
  "trust.reading.title": "読みやすさへの配慮",
  "trust.reading.body":
    "ディスレクシアに配慮した Atkinson Hyperlegible Next と Lexend を標準フォントとして同梱しています。",

  "everyone.heading": "試行錯誤するすべての人へ。",
  "everyone.sub":
    "語彙は汎用的 — 実験室でも、台所でも、工房でも、コードベースでも、教室でも。",
  "everyone.case.lab": "研究者",
  "everyone.case.lab.body":
    "完全な来歴付きの実験ログ。手順・材料・ツール・属性・結果 — ラベル付きで繋がります。",
  "everyone.case.maker": "料理人・つくる人",
  "everyone.case.maker.body":
    "あらゆるバリエーションを覚えているレシピ。今回のパンが上手くいった理由と、上手くいかなかった 4 回も。",
  "everyone.case.engineer": "エンジニア",
  "everyone.case.engineer.body":
    "次のポストモーテムでも残る調査ノート。仮説・証拠・決断、すべてリンクされた状態で。",
  "everyone.case.student": "学生・書き手",
  "everyone.case.student.body":
    "授業・本・会話を横断してアイデアを繋げる第二の脳 — そして、戻ってきた時に自分で説明してくれる。",

  "start.heading": "はじめる。",
  "start.online.title": "ブラウザでプレビュー",
  "start.online.body": "インストール不要。エディタの感触と PROV-DM ラベリングを試せます。ノートはブラウザ（IndexedDB）に保存されます — お試しには十分ですが、AI 機能・永続的な保存・複数端末同期がほしい場合はデスクトップ版か Docker セルフホストを使ってください。",
  "start.online.cta": "プレビューを開く",
  "start.desktop.title": "デスクトップアプリ",
  "start.desktop.body": "macOS Apple Silicon。ファイルシステム保存、AI 機能、Drive/iCloud/Dropbox 同期フォルダによる任意のクラウド同期。",
  "start.desktop.cta": "ダウンロード",
  "start.selfhost.title": "Docker でセルフホスト",
  "start.selfhost.body": "ノートはサーバーに保存され、同じ URL に接続するすべてのブラウザで共有されます。AI バックエンド付き。",
  "start.selfhost.cta": "ガイドを読む",

  "footer.builtBy": "作: ",
  "footer.repo": "GitHub",
  "footer.blog": "ブログ",
  "footer.releases": "Releases",
  "footer.langToggle": "English",
};

const dictionaries: Record<Locale, Record<string, string>> = { en, ja };

function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "ja") return saved;
    const browserLang = navigator.language.toLowerCase();
    if (browserLang.startsWith("ja")) return "ja";
  } catch {
    // ignore (SSR/test)
  }
  return "en";
}

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: keyof typeof en) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, _setLocale] = useState<Locale>(detectLocale);

  const setLocale = useCallback((next: Locale) => {
    _setLocale(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
    document.documentElement.lang = next;
  }, []);

  const t = useCallback(
    (key: keyof typeof en) => dictionaries[locale][key] ?? en[key] ?? String(key),
    [locale],
  );

  return createElement(LocaleContext.Provider, { value: { locale, setLocale, t } }, children);
}

export function useI18n() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useI18n must be used inside <LocaleProvider>");
  return ctx;
}
