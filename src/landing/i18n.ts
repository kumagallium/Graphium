// Landing-page-only i18n. Mirrors the app's storage key (`graphium_locale`) so
// the language choice is shared, but keeps the dictionary tiny so the LP bundle
// stays small.

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { createElement } from "react";

export type Locale = "en" | "ja";

// Shared with the app on purpose: one language preference per origin.
// The app also supports ko, which the landing page does not translate. A saved "ko"
// is left alone here (the landing page just falls back to the browser language), but
// pressing the landing toggle writes "en" or "ja" — and the app then follows that
// explicit choice. This is accepted behavior, not a bug.
const STORAGE_KEY = "graphium_locale";

export const en = {
  // Header nav
  "nav.how": "How",
  "nav.screens": "Screens",
  "nav.faq": "FAQ",
  "nav.start": "Get started",
  "nav.manual": "Manual",

  // Hero
  "hero.eyebrow": "Graphium · Your memory, for every AI",
  "hero.title": "Stop re-explaining yourself to AI.",
  "hero.subtitle":
    "What you read on the web, what was said in a meeting, a scribbled memo, your talks with AI. Keep what you take in in one place on your own computer, and AI answers from your own records — Graphium's built-in AI, or the Claude and ChatGPT desktop apps — with the source attached. The memory stays on your machine, so switching AIs doesn't erase it.",
  "hero.tryOnline": "Try online",
  "hero.seeSample": "See a sample notebook",
  "hero.download": "Download desktop",
  "hero.starOnGithub": "Star on GitHub",
  "hero.videoLabel": "One-minute demo: bring in records, watch the dots connect into topics, trace an answer to its origin",
  "hero.videoCaption":
    "A one-minute video, no sound. Bring in a folder of records, watch the dots connect into topics, and trace the AI's answer back to the note it came from.",

  // How it works (3 steps)
  "how.heading": "Keep, connect, trace.",
  "how.step1.title": "Keep",
  "how.step1.body":
    "Web clips, transcribed recordings, text read from photos and PDFs, quick memos, and photos or voice memos taken on your phone and sent to the desktop. With that many ways in, whatever you come across can go straight in.",
  "how.step2.title": "Connect to your AIs",
  "how.step2.body":
    "Graphium's built-in AI (an API key, your GitHub Copilot subscription, or your ChatGPT Plus / Pro plan) gathers your records into topics. The Claude and ChatGPT desktop apps connect with one button in Settings — they can read your notes and also save what you worked out in the conversation back into them.",
  "how.step3.title": "Trace to the origin",
  "how.step3.body":
    "Any answer, and any line you wrote, walks back to its source note in one click. Notes an outside AI writes carry a mark saying so, so you can hand work to AI with confidence.",

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
  "trust.ai.title": "One memory, any AI",
  "trust.ai.body":
    "The built-in AI runs on your API key, GitHub Copilot subscription, or ChatGPT Plus / Pro plan. Outside AIs — the Claude and ChatGPT desktop apps, Codex, Cursor and more — connect over MCP. Switch AIs and your memory stays put. You decide what goes to which AI.",
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
    "Where Graphium comes into its own. With a GitHub Copilot subscription, AI is one click away — no API key. macOS (Apple Silicon) and Windows.",
  "start.desktop.cta": "Download",

  // FAQ
  "faq.heading": "FAQ",
  "faq.ai.q": "Do I need AI to use it?",
  "faq.ai.a":
    "Writing, linking, and tracing all work without AI. But Graphium comes into its own when you think with it — an API key or a GitHub Copilot subscription connects in minutes.",
  "faq.connect.q": "Which AIs can use my notes?",
  "faq.connect.a":
    "Inside Graphium, the AI you connect with an API key, a GitHub Copilot subscription, or a ChatGPT Plus / Pro plan (desktop app). From outside, the desktop app registers itself with Claude Desktop, Claude Code, Codex and the ChatGPT desktop app in one click (Settings → AI → Use your notes from other AI assistants); other MCP clients such as Cursor take a JSON snippet. In ChatGPT it works from Work-mode conversations in the desktop app; Chat mode, the web, and the phone apps can't reach a tool on your computer.",
  "faq.scope.q": "Can I control what the AI reads?",
  "faq.scope.a":
    "Yes. Every AI conversation has a three-way grounding scope: External adds a fresh web search and is told to cite only what it actually finds, Internal cross-searches the knowledge distilled from your notes, and This note narrows down to just what the note cites — originals first, so quotes come from the source text rather than a summary.",
  "faq.zettel.q": "Is Graphium a Zettelkasten?",
  "faq.zettel.a":
    "In spirit, yes. Insights play the role of permanent notes (one context-free claim per page, traceable to its sources), memos play fleeting notes, and the URLs and papers you ingest play literature notes. The citation note you weave from selected Insights is the structure note (MOC) — and that map doubles as the AI's reading scope. The difference: the AI drafts the candidates and you decide what stays, with every step traceable. The weaving of Insights into new Ideas stays yours.",
  "faq.data.q": "Where does my data live?",
  "faq.data.a":
    "With you. Desktop notes are plain JSON files on your disk, and the browser preview keeps them in your browser. Nothing is sent anywhere without your say.",
  "faq.free.q": "Is it free?",
  "faq.free.a":
    "Yes — Graphium is open source under Apache 2.0 and free to use. If you use the AI features, the only cost is your own API key or AI subscription.",

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

  "hero.eyebrow": "Graphium · AI のための、あなたの記憶",
  "hero.title": "AI に、毎回説明し直さなくていい。",
  "hero.subtitle":
    "Web で読んだもの、会議で話したこと、手書きのメモ、AI との会話。目にしたものを手元のパソコンの 1 か所に残しておくと、Graphium の中の AI からも、Claude や ChatGPT のデスクトップアプリからも、あなたの記録をもとに出どころつきの答えが返ってきます。記憶はあなたのパソコンにあるので、AI を替えても失われません。",
  "hero.tryOnline": "オンラインで試す",
  "hero.seeSample": "見本のノートを見る",
  "hero.download": "デスクトップ版を入手",
  "hero.starOnGithub": "GitHub でスター",
  "hero.videoLabel": "1 分の動画: 記録を入れると点と点がトピックに繋がり、答えの出どころまで辿れるまで",
  "hero.videoCaption":
    "1 分の動画（音声なし）。記録をフォルダごと入れると、点と点がトピックに繋がり、AI の答えから出どころのノートまで辿れます。",

  "how.heading": "残す、つながる、辿る。",
  "how.step1.title": "残す",
  "how.step1.body":
    "Web のクリップ、録音の文字起こし、写真や PDF から読み取った文字、思いついたメモ、スマホで撮った写真や声のメモ（デスクトップへ送れます）。入口がいくつもあるので、目にしたものをそのまま入れておけます。",
  "how.step2.title": "AI とつながる",
  "how.step2.body":
    "Graphium の中の AI（API キー、GitHub Copilot のサブスク、ChatGPT Plus / Pro のプラン）が、記録をトピックに束ねます。Claude や ChatGPT のデスクトップアプリとも設定画面のボタン 1 つでつながり、ノートを読むだけでなく、会話でまとまったことを書き戻すこともできます。",
  "how.step3.title": "辿る",
  "how.step3.body":
    "AI の答えも、あなたが書いた一文も、出どころのノートまでワンクリックで遡れます。外の AI が書き込んだノートにはその印が残るので、安心して AI に任せられます。",

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
  "trust.ai.title": "記憶は 1 つ、AI は選べる",
  "trust.ai.body":
    "Graphium の中の AI は、API キー、GitHub Copilot のサブスク、ChatGPT Plus / Pro のプランで動きます。外の AI（Claude や ChatGPT のデスクトップアプリ、Codex、Cursor など）とは MCP でつながります。AI を乗り換えても、記憶は手元に残ります。何をどの AI に渡すかは、あなたが決められます。",
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
    "Graphium の本領はこちらです。GitHub Copilot のサブスクがあれば API キーなしの 1 クリックで AI が動き出します。macOS (Apple Silicon) / Windows 対応。",
  "start.desktop.cta": "ダウンロード",

  "faq.heading": "よくある質問",
  "faq.ai.q": "AI は必須ですか?",
  "faq.ai.a":
    "書く・繋ぐ・辿るだけなら、AI なしでも動きます。ただ、Graphium の本領は AI と一緒に考えるところにあります。API キーか GitHub Copilot のサブスクがあれば、数分で繋がります。",
  "faq.connect.q": "どの AI から使えますか?",
  "faq.connect.a":
    "Graphium の中では、API キー、GitHub Copilot のサブスク、ChatGPT Plus / Pro のプラン（デスクトップ版）でつないだ AI が使えます。外からは、デスクトップ版の設定（⚙ 設定 → AI → 外の AI からノートを使う）のボタン 1 つで、Claude Desktop・Claude Code・Codex・ChatGPT のデスクトップアプリに登録できます。Cursor など、ほかの MCP 対応アシスタントには JSON を貼り付けます。ChatGPT で使えるのは、デスクトップアプリの Work モードの会話です。Chat モード・Web 版・スマホのアプリからは、パソコンの中のツールにつなげません。",
  "faq.scope.q": "AI が読む範囲は選べますか?",
  "faq.scope.a":
    "選べます。AI との会話には「渡す範囲」という切り替えが付いています。「外部参照」は Web を検索して実際に見つかった出典だけを引くよう指示され、「内部参照」はノートから蒸留された知識を横断検索し、「ノート内参照」は引用したものだけに絞る、という 3 段階です。範囲を絞るのは、引用や数値を要約ではなく原文から引くためなのです。",
  "faq.zettel.q": "Graphium は Zettelkasten ですか?",
  "faq.zettel.a":
    "考え方は Zettelkasten を受け継いでいます。「洞察」が permanent notes（1 ページ 1 主張・出どころまで辿れる）、「メモ」が fleeting notes（走り書き）、取り込んだ URL・論文が literature notes（文献ノート）に当たります。そして洞察を選んで編む引用ノートが structure notes（MOC）で、その「地図」はそのまま AI に渡す範囲としても働くのです。違いは、候補を AI が下書きし、残すかどうかをあなたが決めること。委ねた工程はすべて辿れて、発想へ編む工程はあなたの手に残してあります。",
  "faq.data.q": "データはどこに保存されますか?",
  "faq.data.a":
    "あなたの手元です。デスクトップ版はローカルのプレーンな JSON ファイル、ブラウザ版はブラウザ内に保存されます。断りなく外部へ送ることはありません。",
  "faq.free.q": "無料ですか?",
  "faq.free.a":
    "はい。Apache 2.0 のオープンソースで、アプリは無料です。AI 機能を使うときにかかるのは、あなた自身の API キーや AI サブスクの費用だけです。",

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
