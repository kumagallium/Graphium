// Landing-page-only i18n. Mirrors the app's storage key (`graphium_locale`) so
// the language choice is shared, but keeps the dictionary tiny so the LP bundle
// stays small.

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { createElement } from "react";

export type Locale = "en" | "ja";

const STORAGE_KEY = "graphium_locale";

export const en = {
  // Header nav
  "nav.how": "How",
  "nav.screens": "Screens",
  "nav.faq": "FAQ",
  "nav.start": "Get started",
  "nav.manual": "Manual",

  // Hero
  "hero.eyebrow": "Graphium · An inspiration notebook for the AI era",
  "hero.title": "The more you write, the more the dots connect into insight.",
  "hero.subtitle":
    "Every line — the ones you wrote and the ones the AI handed you — traces back to the note it came from. That traceable trust is what lets the dots connect and insight emerge — and even the insight can show its own origin, later.",
  "hero.tryOnline": "Try online",
  "hero.download": "Download desktop",
  "hero.starOnGithub": "Star on GitHub",
  "hero.shotAlt": "Graphium's graph view: notes, claims, and insights connected",

  // How it works (3 steps)
  "how.heading": "Write, expand, trace.",
  "how.step1.title": "Write",
  "how.step1.body":
    "Jot ideas down as they come and connect them with @ references. Up to here, it feels as light as any note app.",
  "how.step2.title": "Expand with AI",
  "how.step2.body":
    "Connect your own AI — a Claude subscription or an API key — and it lifts claims and insights out of your notes: connections you didn't notice yourself.",
  "how.step3.title": "Trace to the origin",
  "how.step3.body":
    "Any line — yours or the AI's — walks back to its source note in one click. Because you can trace it, you can trust it enough to explore.",

  // Screens
  "screens.heading": "See it in action.",
  "screens.editor.title": "Write and link",
  "screens.editor.body":
    "A block editor with @ references between notes. A recipe tweak, a lab log, an investigation note — any style works.",
  "screens.editor.alt": "Graphium editor showing a note with @-references to other notes",
  "screens.knowledge.title": "AI lifts out the knowledge",
  "screens.knowledge.body":
    "One click, and the AI proposes claims and insights from your notes. You decide what stays.",
  "screens.knowledge.alt": "Knowledge list with AI-extracted claims and insights",
  "screens.trace.title": "Walk back to the origin",
  "screens.trace.body":
    "Open an insight and its lineage sits in the side panel: the claim it grew from, and the notes that claim came from. The origin is always one glance away.",
  "screens.trace.alt": "An insight page with its lineage panel showing the source claim and source notes",

  // For everyone
  "everyone.heading": "For everyone who tinkers.",
  "everyone.sub":
    "The vocabulary is generic: labs, kitchens, workshops, codebases, classrooms.",
  "everyone.case.lab": "Researchers",
  "everyone.case.lab.body":
    "Experiment logs with provenance — steps, materials, results, all linked.",
  "everyone.case.maker": "Cooks & makers",
  "everyone.case.maker.body":
    "Recipes that remember why this loaf worked, and the four that didn't.",
  "everyone.case.engineer": "Engineers",
  "everyone.case.engineer.body":
    "Investigation notes that survive the next post-mortem.",
  "everyone.case.student": "Students & writers",
  "everyone.case.student.body":
    "A second brain that links courses, books, and conversations — and explains itself.",

  // Built for trust
  "trust.heading": "Built for trust.",
  "trust.sub": "Your AI, your storage, open source.",
  "trust.ai.title": "Runs on your own AI",
  "trust.ai.body":
    "Graphium is built to think alongside AI — your AI. A Claude subscription or an API key connects it, and nothing is sent anywhere without your say.",
  "trust.storage.title": "Your storage",
  "trust.storage.body":
    "Notes are plain JSON files on your disk (desktop) or in your browser (web). Point the desktop app at a Drive / iCloud / Dropbox folder for sync with no extra accounts.",
  "trust.open.title": "Open source & open standards",
  "trust.open.body":
    "A personal open-source project under Apache 2.0. Provenance exports as W3C PROV-DM JSON-LD, so your data stays readable outside Graphium.",

  // Get started
  "start.heading": "Get started.",
  "start.online.title": "Preview in browser",
  "start.online.body":
    "No install — try the writing feel first. Notes stay in your browser.",
  "start.online.cta": "Open the preview",
  "start.desktop.title": "Desktop app",
  "start.desktop.body":
    "Where Graphium comes into its own. With a Claude subscription, AI is one click away — no API key. macOS (Apple Silicon) and Windows.",
  "start.desktop.cta": "Download",
  "start.selfhost.title": "Self-host with Docker",
  "start.selfhost.body":
    "Notes on your own server, reachable from any browser. AI backend included.",
  "start.selfhost.cta": "Read the guide",

  // FAQ
  "faq.heading": "FAQ",
  "faq.ai.q": "Do I need AI to use it?",
  "faq.ai.a":
    "Writing, linking, and tracing all work without AI. But Graphium comes into its own when you think with it — a Claude subscription or an API key connects in minutes.",
  "faq.scope.q": "Can I control what the AI reads?",
  "faq.scope.a":
    "Yes. Every AI conversation has a three-way grounding scope: External adds a fresh web search and is told to cite only what it actually finds, Internal cross-searches the knowledge distilled from your notes, and This note narrows down to just what the note cites — originals first, so quotes come from the source text rather than a summary.",
  "faq.zettel.q": "Is Graphium a Zettelkasten?",
  "faq.zettel.a":
    "In spirit, yes. Insights play the role of permanent notes (one context-free claim per page, traceable to its sources), memos play fleeting notes, and the URLs and papers you ingest play literature notes. The citation note you weave from selected Insights is the structure note (MOC) — and that map doubles as the AI's reading scope. The difference: the AI drafts the candidates and you decide what stays, with every step traceable. The weaving of Insights into new Ideas stays yours.",
  "faq.data.q": "Where does my data live?",
  "faq.data.a":
    "With you. Desktop notes are plain JSON files on your disk, the browser preview keeps them in your browser, and self-hosting keeps them on your server. Nothing is sent anywhere without your say.",
  "faq.free.q": "Is it free?",
  "faq.free.a":
    "Yes — Graphium is open source under Apache 2.0 and free to use. If you use the AI features, the only cost is your own Claude subscription or API key.",

  // Footer
  "footer.builtBy": "Built by",
  "footer.repo": "GitHub",
  "footer.blog": "Blog",
  "footer.releases": "Releases",
  "footer.manual": "Manual",
  "footer.langToggle": "日本語",
} as const;

export const ja: Record<keyof typeof en, string> = {
  "nav.how": "仕組み",
  "nav.screens": "画面",
  "nav.faq": "FAQ",
  "nav.start": "はじめる",
  "nav.manual": "マニュアル",

  "hero.eyebrow": "Graphium · AI 時代のひらめきノート",
  "hero.title": "書けば書くほど、点と点が繋がる「ひらめきノート」",
  "hero.subtitle":
    "あなたが書いた一文も、AI が手渡してくれた一文も、その出どころのノートまで辿れます。辿れるという信頼があるからこそ、安心して点と点が繋がり、ひらめきが生まれます。そしてその「ひらめきの起源」も、あとから示せるのです。",
  "hero.tryOnline": "オンラインで試す",
  "hero.download": "デスクトップ版を入手",
  "hero.starOnGithub": "GitHub でスター",
  "hero.shotAlt": "ノート・知見・洞察が繋がった Graphium のグラフビュー",

  "how.heading": "書く、広げる、辿る。",
  "how.step1.title": "書く",
  "how.step1.body":
    "思いつきをそのまま書き、@ 参照でノート同士を繋ぎます。ここまでは、ふつうのノートと同じ気軽さです。",
  "how.step2.title": "AI と広げる",
  "how.step2.body":
    "あなたの AI(Claude のサブスクや API キー)を繋ぐと、AI がノートの群れから「知見」や「洞察」を拾い上げます。自分では気づかなかった繋がりが見えてきます。",
  "how.step3.title": "起源まで辿る",
  "how.step3.body":
    "AI が手渡した一文も、あなたが書いた一文も、出どころのノートまでワンクリックで遡れます。辿れるからこそ、安心して広げられるのです。",

  "screens.heading": "実際の画面。",
  "screens.editor.title": "書いて、繋ぐ",
  "screens.editor.body":
    "ブロックエディタに書いて、@ 参照で繋ぎます。レシピの改良メモから実験ログまで、書き方は自由です。",
  "screens.editor.alt": "他のノートへの @ 参照を含むノートを開いた Graphium エディタ",
  "screens.knowledge.title": "AI が知見を拾い上げる",
  "screens.knowledge.body":
    "ワンクリックで、AI がノートから「知見」と「洞察」の候補を取り出します。残すかどうかは、あなたが決めます。",
  "screens.knowledge.alt": "AI が抽出した知見・洞察が並ぶ Knowledge リスト",
  "screens.trace.title": "ひらめきの起源まで遡れる",
  "screens.trace.body":
    "洞察を開くと、右のパネルに「来歴」が並びます。もとになった知見、その知見のもとのノートへと、いつでも遡れるのです。",
  "screens.trace.alt": "来歴パネル(洞察・知見・元ノート)を開いた洞察ページ",

  "everyone.heading": "試行錯誤するすべての人へ。",
  "everyone.sub": "実験室でも、台所でも、工房でも、コードベースでも、教室でも。",
  "everyone.case.lab": "研究者",
  "everyone.case.lab.body":
    "来歴付きの実験ログ。ステップ・材料・結果が繋がったまま残ります。",
  "everyone.case.maker": "料理人・つくる人",
  "everyone.case.maker.body":
    "今回のパンが上手くいった理由を覚えているレシピ。上手くいかなかった 4 回も一緒に。",
  "everyone.case.engineer": "エンジニア",
  "everyone.case.engineer.body":
    "次のポストモーテムまで生き残る調査ノート。",
  "everyone.case.student": "学生・書き手",
  "everyone.case.student.body":
    "授業・本・会話を繋ぐ「第二の脳」。戻ってきたとき、自分で説明してくれます。",

  "trust.heading": "信頼できる土台。",
  "trust.sub": "あなたの AI、あなたのストレージ、オープンソース。",
  "trust.ai.title": "あなたの AI で動く",
  "trust.ai.body":
    "Graphium は AI と一緒に考えるためのノートです。動かすのは「あなたの AI」(Claude のサブスクや API キー)。何を渡すかはあなたが決め、断りなく外部へ送りません。",
  "trust.storage.title": "あなたのストレージ",
  "trust.storage.body":
    "ノートはプレーンな JSON ファイルとして、デスクトップ版ならローカルに、Web 版ならブラウザ内に保存されます。保存先を Drive / iCloud / Dropbox の同期フォルダにすれば、追加のアカウント連携なしで同期できます。",
  "trust.open.title": "オープンソース & オープン標準",
  "trust.open.body":
    "Apache 2.0 で公開している個人開発プロジェクトです。来歴は W3C PROV-DM 準拠の JSON-LD として書き出せるので、データは Graphium の外でも読めます。",

  "start.heading": "はじめる。",
  "start.online.title": "ブラウザでプレビュー",
  "start.online.body":
    "インストール不要で、まず書き心地を試せます。ノートはブラウザ内に保存されます。",
  "start.online.cta": "プレビューを開く",
  "start.desktop.title": "デスクトップアプリ",
  "start.desktop.body":
    "Graphium の本領はこちらです。Claude のサブスクがあれば API キーなしの 1 クリックで AI が動き出します。macOS (Apple Silicon) / Windows 対応。",
  "start.desktop.cta": "ダウンロード",
  "start.selfhost.title": "Docker でセルフホスト",
  "start.selfhost.body":
    "ノートは自分のサーバーに置き、どのブラウザからも同じノートに繋がります。AI バックエンド付き。",
  "start.selfhost.cta": "ガイドを読む",

  "faq.heading": "よくある質問",
  "faq.ai.q": "AI は必須ですか?",
  "faq.ai.a":
    "書く・繋ぐ・辿るだけなら、AI なしでも動きます。ただ、Graphium の本領は AI と一緒に考えるところにあります。Claude のサブスクか API キーがあれば、数分で繋がります。",
  "faq.scope.q": "AI が読む範囲は選べますか?",
  "faq.scope.a":
    "選べます。AI との会話には「渡す範囲」という切り替えが付いています。「外部参照」は Web を検索して実際に見つかった出典だけを引くよう指示され、「内部参照」はノートから蒸留された知識を横断検索し、「ノート内参照」は引用したものだけに絞る、という 3 段階です。範囲を絞るのは、引用や数値を要約ではなく原文から引くためなのです。",
  "faq.zettel.q": "Graphium は Zettelkasten ですか?",
  "faq.zettel.a":
    "考え方は Zettelkasten を受け継いでいます。「洞察」が permanent notes（1 ページ 1 主張・出どころまで辿れる）、「メモ」が fleeting notes（走り書き）、取り込んだ URL・論文が literature notes（文献ノート）に当たります。そして洞察を選んで編む引用ノートが structure notes（MOC）で、その「地図」はそのまま AI に渡す範囲としても働くのです。違いは、候補を AI が下書きし、残すかどうかをあなたが決めること。委ねた工程はすべて辿れて、発想へ編む工程はあなたの手に残してあります。",
  "faq.data.q": "データはどこに保存されますか?",
  "faq.data.a":
    "あなたの手元です。デスクトップ版はローカルのプレーンな JSON ファイル、ブラウザ版はブラウザ内、セルフホスト版はあなたのサーバーに保存されます。断りなく外部へ送ることはありません。",
  "faq.free.q": "無料ですか?",
  "faq.free.a":
    "はい。Apache 2.0 のオープンソースで、アプリは無料です。AI 機能を使うときにかかるのは、あなた自身の Claude サブスクや API キーの費用だけです。",

  "footer.builtBy": "作: ",
  "footer.repo": "GitHub",
  "footer.blog": "ブログ",
  "footer.releases": "Releases",
  "footer.manual": "マニュアル",
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
