// Landing-page-only i18n. Mirrors the app's storage key (`graphium_locale`) so
// the language choice is shared, but keeps the dictionary tiny so the LP bundle
// stays small.

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { createElement } from "react";

export type Locale = "en" | "ja";

const STORAGE_KEY = "graphium_locale";

export const en = {
  // Hero
  "hero.title": "Turn information into knowledge you can reuse, anytime.",
  "hero.subtitle":
    "A block-based note editor where every claim — yours and the AI's — is anchored to the notes that justify it. PROV-DM provenance, an editable Knowledge layer, and content-addressed sharing, all in one place.",
  "hero.tryOnline": "Try online",
  "hero.download": "Download desktop",
  "hero.starOnGithub": "Star on GitHub",

  // Problem
  "problem.heading": "Most notes get vaguer with time.",
  "problem.lead":
    "Months later, you re-read your own page and cannot tell: was that number measured, or assumed? Was that paragraph yours, or did an LLM hand it to you on a tired afternoon? How did you arrive at this idea in the first place?",
  "problem.tagline": "Graphium notes get sharper as you write.",
  "problem.body":
    "The fix is provenance, and provenance cannot be bolted on later. It has to live in the spine of how the editor stores text. Graphium's spine is W3C PROV-DM, and its AI features are obligated to travel the same trail.",

  // How it thinks (3 pillars)
  "pillars.heading": "Three layers, one editor.",
  "pillars.sub": "Use as much, or as little, as you need.",

  "pillar.link.title": "Link",
  "pillar.link.body":
    "Write atomic notes and connect them with `@` references. Drop into ⌘K to search, jump, or ask. Small ideas linking until something clicks — Zettelkasten-style, on top of BlockNote.js.",

  "pillar.trace.title": "Trace",
  "pillar.trace.body":
    "Two passes, both optional. Tag a heading as `[Step]` (or as a phase, `[Plan]` / `[Result]`); highlight inline spans as `[Input]` / `[Tool]` / `[Parameter]` / `[Output]` to mark the entities involved. The two layers compose into a W3C PROV-DM graph you can export as JSON-LD.",

  "pillar.extend.title": "Extend",
  "pillar.extend.body":
    "Plug in an LLM and a second layer emerges: a Knowledge layer of Claims, Insights, and Ideas, every claim citing the notes it came from. Reusable Skills (prompt templates) and ⌘K composer ride on top.",

  // Built for trust
  "trust.heading": "Built for trust.",
  "trust.sub": "Open standards, open source, your storage.",
  "trust.standards.title": "Open standards",
  "trust.standards.body":
    "Provenance exports as W3C PROV-JSON-LD. Any tool that reads PROV-DM can read your data.",
  "trust.openSource.title": "Open source (Apache 2.0)",
  "trust.openSource.body":
    "A personal open-source project, all of it on GitHub. Self-host with Docker, audit the code, or send a PR.",
  "trust.storage.title": "Your storage",
  "trust.storage.body":
    "Notes are plain JSON files on your filesystem (desktop) or in your browser (web). Point the desktop app at a Google Drive / iCloud / Dropbox synced folder if you want sync, with no extra OAuth.",
  "trust.ai.title": "AI is opt-in",
  "trust.ai.body":
    "Without an LLM, Graphium is a clean linked-note editor. Plug one in to activate the Knowledge Layer.",
  "trust.reading.title": "Reading comfort",
  "trust.reading.body":
    "Inter by default, with Atkinson Hyperlegible Next and Lexend bundled as opt-in fonts for dyslexia-aware reading.",

  "trust.share.title": "Share with provenance intact",
  "trust.share.body":
    "Library, Fork, and content-addressed blob storage let a note travel without losing its trail. Today the shared backend is a local folder; other backends (S3, NAS, Zenodo) are pluggable.",

  // For everyone
  "everyone.heading": "For everyone who tinkers.",
  "everyone.sub":
    "The vocabulary is generic: labs, kitchens, workshops, codebases, classrooms.",
  "everyone.case.lab": "Researchers",
  "everyone.case.lab.body":
    "Experimental logs with full provenance. Steps, materials, tools, results — labeled and linked.",
  "everyone.case.maker": "Cooks & makers",
  "everyone.case.maker.body":
    "Recipes that remember every variation. Why this version of the bread worked, and the four that didn't.",
  "everyone.case.engineer": "Engineers",
  "everyone.case.engineer.body":
    "Investigation notes that survive the next post-mortem. Hypotheses, evidence, decisions — all linked.",
  "everyone.case.student": "Students & writers",
  "everyone.case.student.body":
    "A second brain that links ideas across courses, books, and conversations, and explains itself when you come back.",

  // Get started
  "start.heading": "Get started.",
  "start.online.title": "Preview in browser",
  "start.online.body":
    "No install. Try the editor and PROV-DM labeling. Notes live in your browser (IndexedDB), which is fine for kicking the tires. The desktop app or self-hosted Docker is what you want for the full experience (AI Knowledge Layer, durable storage, cross-device sync).",
  "start.online.cta": "Open the preview",
  "start.desktop.title": "Desktop app",
  "start.desktop.body":
    "macOS Apple Silicon today. Local files, AI features, optional cloud sync via OS-level Drive / iCloud / Dropbox folders.",
  "start.desktop.cta": "Download",
  "start.selfhost.title": "Self-host with Docker",
  "start.selfhost.body":
    "Notes stored on your server, accessible from any browser at the same URL. AI backend included.",
  "start.selfhost.cta": "Read the guide",

  // Footer
  "footer.builtBy": "Built by",
  "footer.repo": "GitHub",
  "footer.blog": "Blog",
  "footer.releases": "Releases",
  "footer.langToggle": "日本語",
} as const;

export const ja: Record<keyof typeof en, string> = {
  "hero.title": "情報を、いつでも再利用可能な「知識」へと変える。",
  "hero.subtitle":
    "あなたが書いた一文も、AI が手渡してくれた一文も、その根拠となるノートまで辿れる。PROV-DM 来歴・編集可能なナレッジ層・コンテンツアドレス型の共有を、ひとつのエディタにまとめました。",
  "hero.tryOnline": "オンラインで試す",
  "hero.download": "デスクトップ版を入手",
  "hero.starOnGithub": "GitHub でスター",

  "problem.heading": "普通のノートは、時間とともに曖昧になる。",
  "problem.lead":
    "数ヶ月後、自分のページを読み返してこう問われると、答えに詰まります。その数字は測ったものか、それとも仮定だったか。その段落は自分の言葉か、それとも疲れた午後に LLM が手渡してくれたものか。このアイデアに、自分はどんな道のりで辿り着いたのか。",
  "problem.tagline": "Graphium のノートは、書くほどに鋭くなります。",
  "problem.body":
    "答えは「来歴（プロヴェナンス）」にあります。来歴は、後から付け足せる機能ではありません。エディタがテキストを保存するときの背骨に組み込む必要があります。Graphium の背骨は W3C の [PROV-DM](https://www.w3.org/TR/prov-dm/) であり、AI 機能にも同じ来歴の道を辿らせています。",

  "pillars.heading": "3 つのレイヤー、ひとつのエディタ。",
  "pillars.sub": "必要な分だけ使えばいい。",

  "pillar.link.title": "つなぐ",
  "pillar.link.body":
    "原子ノートを書き、`@` 参照でつなぎます。⌘K で検索・ジャンプ・AI への問いかけを 1 アクションで。小さなアイデアが繋がって何かが噛み合う瞬間を、BlockNote.js ベースのエディタの上に作ります。",

  "pillar.trace.title": "辿る",
  "pillar.trace.body":
    "ラベル付けは独立した二層からなります。見出しを `[ステップ]`（または Phase の `[計画]` / `[結果]`）でタグ付けし、本文内の語句を `[インプット]` / `[ツール]` / `[パラメータ]` / `[アウトプット]` でハイライトして関わるエンティティをマーク。両者が組み合わさって W3C PROV-DM のグラフを成し、JSON-LD として書き出せます。",

  "pillar.extend.title": "広げる",
  "pillar.extend.body":
    "LLM をつなぐと、もう一層が立ち上がります。知見・洞察・発想からなる「ナレッジ層」、再利用可能な Skill（プロンプトテンプレート）、⌘K の Composer。AI のすべての主張は、出どころのノートを引用します。",

  "trust.heading": "信頼できる土台。",
  "trust.sub": "オープン標準、オープンソース、あなたのストレージ。",
  "trust.standards.title": "オープン標準",
  "trust.standards.body":
    "来歴は W3C PROV-JSON-LD として書き出せます。PROV-DM を読めるツールならどれでも読み込めます。",
  "trust.openSource.title": "オープンソース（Apache 2.0）",
  "trust.openSource.body":
    "個人で開発しているオープンソース・プロジェクトで、コードはすべて GitHub にあります。Docker でセルフホストもでき、監査も Pull Request も自由です。",
  "trust.storage.title": "あなたのストレージ",
  "trust.storage.body":
    "ノートはあなたのファイルシステム（デスクトップ版）またはブラウザ（Web 版）にプレーンな JSON で保存されます。デスクトップ版の保存先を Google Drive / iCloud / Dropbox の同期フォルダに指定すれば、追加の OAuth 連携なしでクラウド同期できます。",
  "trust.ai.title": "AI はオプトイン",
  "trust.ai.body":
    "LLM を繋がなくても、シンプルなリンクノートエディタとして動きます。繋ぐと Knowledge Layer が立ち上がります。",
  "trust.reading.title": "読みやすさへの配慮",
  "trust.reading.body":
    "デフォルトは Inter。ディスレクシアに配慮した Atkinson Hyperlegible Next と Lexend を同梱し、設定で切り替えられます。",

  "trust.share.title": "来歴を保ったまま共有する",
  "trust.share.body":
    "Library・Fork・コンテンツアドレス型ブロブストレージにより、ノートが来歴を失わずに移動できます。共有バックエンドは現状ローカルフォルダのみですが、S3 / NAS / Zenodo など差し替え可能な構造です。",

  "everyone.heading": "試行錯誤するすべての人へ。",
  "everyone.sub":
    "語彙は汎用的です。実験室でも、台所でも、工房でも、コードベースでも、教室でも。",
  "everyone.case.lab": "研究者",
  "everyone.case.lab.body":
    "完全な来歴付きの実験ログ。ステップ・材料・ツール・結果が、ラベル付きで繋がります。",
  "everyone.case.maker": "料理人・つくる人",
  "everyone.case.maker.body":
    "あらゆるバリエーションを覚えているレシピ。今回のパンが上手くいった理由と、上手くいかなかった 4 回も。",
  "everyone.case.engineer": "エンジニア",
  "everyone.case.engineer.body":
    "次のポストモーテムでも残る調査ノート。仮説・証拠・決断のすべてが、リンクされた状態で。",
  "everyone.case.student": "学生・書き手",
  "everyone.case.student.body":
    "授業・本・会話を横断してアイデアを繋げる「第二の脳」。戻ってきたときに、自分で説明してくれます。",

  "start.heading": "はじめる。",
  "start.online.title": "ブラウザでプレビュー",
  "start.online.body":
    "インストール不要です。エディタの感触と PROV-DM ラベリングを試せます。ノートはブラウザ（IndexedDB）に保存されます。お試しには十分ですが、AI Knowledge Layer・永続的な保存・複数端末同期がほしい場合は、デスクトップ版か Docker セルフホストをご利用ください。",
  "start.online.cta": "プレビューを開く",
  "start.desktop.title": "デスクトップアプリ",
  "start.desktop.body":
    "現在は macOS Apple Silicon に対応。ファイルシステム保存、AI 機能、Drive / iCloud / Dropbox 同期フォルダによる任意のクラウド同期。",
  "start.desktop.cta": "ダウンロード",
  "start.selfhost.title": "Docker でセルフホスト",
  "start.selfhost.body":
    "ノートはサーバーに保存され、同じ URL に接続するすべてのブラウザで共有されます。AI バックエンド付き。",
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
