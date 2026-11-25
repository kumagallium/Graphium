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
  "hero.eyebrow": "Graphium · Your records in one place, readable by you and by AI",
  "hero.title": "Wake your sleeping records. Readable by you, and by AI.",
  "hero.subtitle":
    "Photos of lab notebook pages, recordings of meetings, papers and web pages you read, old data files. Put them in one place and they become text you can search later. What you record from now on goes into the same place, so it never has to sleep. Everything up to here works without AI. Once you start using AI, it reads the same records as they are and answers with the source attached.",
  "hero.seeSample": "See a sample lab notebook",
  "hero.download": "Download desktop",
  "hero.videoLabel": "One-minute demo: bring in records, watch the dots connect into topics, trace an answer to its origin",
  "hero.videoCaption":
    "A one-minute video, no sound. Bring in a folder of records, watch the dots connect into topics, and trace the AI's answer back to the note it came from.",

  // How it works (3 steps)
  "how.heading": "Bring in, find, connect to AI.",
  "how.step1.title": "Bring in",
  "how.step1.body":
    "Web clips, transcribed recordings, text read from photos and PDFs, quick memos, photos and voice memos taken on your phone, and old files brought in by the folder. With that many ways in, old records and today's records land in the same place. Web clips, transcription, and receiving from your phone run in the desktop app.",
  "how.step2.title": "Find",
  "how.step2.body":
    "Whatever you bring in is already text, so you can search it by words. Link notes with @ and see the connections as a graph. Everything up to here works without AI.",
  "how.step3.title": "Connect to AI",
  "how.step3.body":
    "Once you start using AI, the same records are what it reads. Graphium's built-in AI gathers your records into topics, and the Claude and ChatGPT desktop apps connect with one button in Settings. You can trace an AI's answer back to the source note.",

  // Screens
  "screens.heading": "See it in action.",
  "screens.editor.title": "Write and link",
  "screens.editor.body":
    "A block editor with @ references between notes. A recipe tweak, a lab log, an investigation note — any style works.",
  "screens.editor.alt": "Graphium editor showing a note with @-references to other notes",
  "screens.knowledge.title": "Once you use AI: it lifts out the knowledge",
  "screens.knowledge.body":
    "Once you connect an AI, one click has it propose claims and insights from your notes. You decide what stays.",
  "screens.knowledge.alt": "Knowledge list with AI-extracted claims and insights",
  "screens.trace.title": "Walk back to the origin",
  "screens.trace.body":
    "Open an insight and its lineage sits in the side panel: the claim it grew from, and the notes that claim came from. The origin is always one glance away.",
  "screens.trace.alt": "An insight page with its lineage panel showing the source claim and source notes",

  // For everyone
  "everyone.heading": "First, for researchers with years of lab records.",
  "everyone.sub":
    "How each sample was made, the conditions of each measurement, the runs that didn't work. Keep what you tried in a form you can trace later. The same habits work in kitchens, workshops, codebases and classrooms.",
  "everyone.case.lab": "Researchers",
  "everyone.case.lab.body":
    "Lab notes that keep steps, materials, conditions and results connected. Link runs with @ and trace what changed from one run to the next.",
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
  "trust.ai.title": "Pick your AI later",
  "trust.ai.body":
    "You can start without any AI. When you want one, the built-in AI runs on your API key, GitHub Copilot subscription, or ChatGPT Plus / Pro plan, and outside AIs (the Claude and ChatGPT desktop apps, Codex, Cursor and more) connect over MCP. Your records stay on your side, so switching AIs doesn't change them, and you decide what goes to which AI.",
  "trust.storage.title": "Your storage",
  "trust.storage.body":
    "Notes are plain JSON files on your disk (desktop) or in your browser (web). Point the desktop app at a Drive / iCloud / Dropbox folder for sync with no extra accounts.",
  "trust.open.title": "Open source & open standards",
  "trust.open.body":
    "A personal open-source project under Apache 2.0. Provenance exports as W3C PROV-DM JSON-LD, so your data stays readable outside Graphium.",
  "trust.seal.title": "\"When\" and \"what\", checkable by others",
  "trust.seal.body":
    "Seal a saved point as evidence, and only a 32-byte hash of its content goes to outside timestamp services. From the exported zip, anyone can check without Graphium that this content existed before that time. That is all it proves: it does not prove who wrote it. Timestamps are added in the desktop app.",

  // Get started
  "start.heading": "Get started.",
  "start.online.title": "Preview in browser",
  "start.online.body":
    "No install, so you can try the writing feel first. Notes stay in your browser. Bringing in files and folders, reading text from images and PDFs, searching by words, and linking notes with @ work here without AI. Web clips, transcribing recordings, and receiving from your phone need the desktop app.",
  "start.online.cta": "Open the preview",
  "start.desktop.title": "Desktop app",
  "start.desktop.body":
    "Web clips, recordings turned into text, photos and voice memos from your phone, whole folders of old files, and searching across them: all of it works without AI. When you want AI, a GitHub Copilot subscription connects in one click with no API key. macOS (Apple Silicon) and Windows.",
  "start.desktop.cta": "Download",
  "start.sample.title": "Sample lab notebook",
  "start.sample.body":
    "A made-up thermoelectric materials study: solid-state synthesis, XRD and Seebeck measurements, with the topics an AI built from them. Opens in your browser without connecting any AI, and nothing you add there mixes with your own notes.",
  "start.sample.cta": "Open the sample",

  // FAQ
  "faq.heading": "FAQ",
  "faq.ai.q": "Do I need AI to use it?",
  "faq.ai.a":
    "No. Bringing records in, turning them into text, searching by words, and linking notes with @ all work without AI. Some of it needs the desktop app: web clips, transcribing recordings, and receiving photos and voice memos from your phone. Importing files and folders, reading text from images and PDFs, and searching also work in the browser. AI comes in when you want records gathered into topics, claims and insights drawn out, questions answered from your records, or procedure notes built from PDFs and URLs. When you start using AI, an API key or a GitHub Copilot subscription connects in minutes.",
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

  // Concept picture in the hero (MomentsPicture). Show only what the released app really does;
  // the origin tags are the app's own words (records.origin.* in src/i18n)
  "moments.before.heading": "Records left asleep",
  "moments.before.foot": "You have to open each one to know what is inside",
  "moments.in.heading": "Put them into a Graphium note",
  "moments.note.kind": "Note",
  "moments.note.title": "Bread class planning",
  "moments.tr.heading": "Transcript",
  "moments.tr.other": "Others",
  "moments.tr.self": "Me",
  "moments.tr.line2": "Agreed. Two degrees lower, same timing.",
  "moments.ocr.done": "Text extracted (40 chars)",
  "moments.ocr.text": "Dough temperature 26°C\nFirst proof 60 min",
  "moments.out.heading": "Find it, trace it. AI can read it too",
  "moments.who.self": "Me",
  "moments.photo.before": "A photo of a recipe sheet",
  "moments.photo.where": "From phone",
  "moments.photo.name": "recipe-sheet.jpg",
  "moments.photo.hit": "Dough temperature 26°C, first proof 60 min",
  "moments.audio.before": "A meeting recording",
  "moments.audio.where": "Imported file",
  "moments.audio.name": "Bread class meeting.m4a",
  "moments.audio.hit": "Next time, let's lower the proofing temperature first",
  "moments.web.before": "A web page you read",
  "moments.web.where": "Web clip",
  "moments.web.name": "Why a long, cool proof changes the flavor",
  "moments.web.hit": "At a lower temperature, the dough rises slowly",
  "moments.pdf.before": "An old file",
  "moments.pdf.where": "Imported file",
  "moments.pdf.name": "Bread basics, chapter 3.pdf",
  "moments.pdf.hit": "One degree of dough temperature visibly speeds up the proof",
  "moments.person.label": "You",
  "moments.query": "temperature",
  "moments.placeholder": "Find by words",
  "moments.hits": "4 found",
  "moments.ai.label": "Once you start using AI",
  "moments.who.ai": "AI",
  "moments.trace.label": "Follow where it came from",
  "moments.trace.usedIn": "Used in 1 note",
  "moments.trace.note.where": "From a recording",
  "moments.trace.note.name": "Bread class planning",
  "moments.trace.topic.where": "Made into knowledge",
  "moments.trace.topic.name": "Cool proofing and flavor",
  "moments.trace.sources": "From 3 records",
  "moments.note": "Text in photos is read on your device and works for printed text. Transcribing recordings and web clips run in the desktop app.",

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

  "hero.eyebrow": "Graphium · 記録を 1 か所に、人にも AI にも読める形で",
  "hero.title": "眠っている記録を、人にも AI にも読める形に。",
  "hero.subtitle":
    "実験ノートの写真、打ち合わせの録音、読んだ論文や Web ページ、昔の測定データ。1 か所に入れると文字になって、あとで探せます。これから残す記録も同じ場所に入るので、眠らせずに済みます。ここまでは AI なしで動きます。AI を使い始めたら、同じ記録を AI がそのまま読んで、出どころつきで答えます。",
  "hero.seeSample": "実験ノートの見本を見る",
  "hero.download": "デスクトップ版を入手",
  "hero.videoLabel": "1 分の動画: 記録を入れると点と点がトピックに繋がり、答えの出どころまで辿れるまで",
  "hero.videoCaption":
    "1 分の動画（音声なし）。記録をフォルダごと入れると、点と点がトピックに繋がり、AI の答えから出どころのノートまで辿れます。",

  "how.heading": "入れる、探す、AI とつながる。",
  "how.step1.title": "入れる",
  "how.step1.body":
    "Web のクリップ、録音の文字起こし、写真や PDF から読み取った文字、思いついたメモ、スマホで撮った写真や声のメモ、昔のファイルのまとめての取り込み。入口がいくつもあるので、昔の記録も今日の記録も同じ場所に入ります。Web のクリップ、録音の文字起こし、スマホからの受け取りは、デスクトップ版で動きます。",
  "how.step2.title": "探す",
  "how.step2.body":
    "入れた記録は文字になっているので、言葉で探せます。ノート同士は @ でつなげて、つながりをグラフで見渡せます。ここまでは AI なしで動きます。",
  "how.step3.title": "AI とつながる",
  "how.step3.body":
    "AI を使い始めたら、同じ記録がそのまま AI の読むものになります。Graphium の中の AI が記録をトピックに束ね、Claude や ChatGPT のデスクトップアプリとも設定画面のボタン 1 つでつながります。AI の答えは、出どころのノートまで辿れます。",

  "screens.heading": "実際の画面。",
  "screens.editor.title": "書いて、繋ぐ",
  "screens.editor.body":
    "ブロックエディタに書いて、@ 参照で繋ぎます。レシピの改良メモから実験ログまで、書き方は自由です。",
  "screens.editor.alt": "他のノートへの @ 参照を含むノートを開いた Graphium エディタ",
  "screens.knowledge.title": "AI を使い始めたら、知見を拾い上げる",
  "screens.knowledge.body":
    "AI をつないだあとは、ワンクリックでノートから「知見」と「洞察」の候補を取り出します。残すかどうかは、あなたが決めます。",
  "screens.knowledge.alt": "AI が抽出した知見・洞察が並ぶ Knowledge リスト",
  "screens.trace.title": "ひらめきの起源まで遡れる",
  "screens.trace.body":
    "洞察を開くと、右のパネルに「来歴」が並びます。もとになった知見、その知見のもとのノートへと、いつでも遡れます。",
  "screens.trace.alt": "来歴パネル(洞察・知見・元ノート)を開いた洞察ページ",

  "everyone.heading": "まず、実験の記録を溜めてきた研究者へ。",
  "everyone.sub":
    "試料をどう作ったか、どの条件で測ったか、うまくいかなかった回。試したことを、あとから辿れる形で残します。同じ使い方は、台所でも、工房でも、コードベースでも、教室でもできます。",
  "everyone.case.lab": "研究者",
  "everyone.case.lab.body":
    "手順・材料・条件・結果がつながったまま残る実験ノート。条件を変えた回どうしを @ でつなぎ、前の回から何を変えたかを辿れます。",
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
  "trust.ai.title": "AI はあとから選べる",
  "trust.ai.body":
    "AI なしで使い始められます。使いたくなったら、Graphium の中の AI は API キー、GitHub Copilot のサブスク、ChatGPT Plus / Pro のプランで動きます。外の AI（Claude や ChatGPT のデスクトップアプリ、Codex、Cursor など）とは MCP でつながります。記録はあなたの手元にあるので、AI を乗り換えても変わりません。何をどの AI に渡すかは、あなたが決められます。",
  "trust.storage.title": "あなたのストレージ",
  "trust.storage.body":
    "ノートはプレーンな JSON ファイルとして、デスクトップ版ならローカルに、Web 版ならブラウザ内に保存されます。保存先を Drive / iCloud / Dropbox の同期フォルダにすれば、追加のアカウント連携なしで同期できます。",
  "trust.open.title": "オープンソース & オープン標準",
  "trust.open.body":
    "Apache 2.0 で公開している個人開発プロジェクトです。来歴は W3C PROV-DM 準拠の JSON-LD として書き出せるので、データは Graphium の外でも読めます。",
  "trust.seal.title": "「いつ・何が」を、第三者が確かめられる",
  "trust.seal.body":
    "残した時点を「証拠として固定」すると、内容のハッシュ（32 バイト）だけを外部の時刻証明サービスに預けます。「この時刻より前に、この内容があった」ことを、書き出した zip から Graphium なしで確かめられます。証明するのはそこまでで、誰が書いたかは証明しません。時刻の証明はデスクトップ版で付きます。",

  "start.heading": "はじめる。",
  "start.online.title": "ブラウザでプレビュー",
  "start.online.body":
    "インストール不要で、まず書き心地を試せます。ノートはブラウザ内に保存されます。ファイルやフォルダの取り込み、画像や PDF の文字の読み取り、言葉での検索、@ でのつなぎは、ここでも AI なしで動きます。Web のクリップ、録音の文字起こし、スマホからの受け取りには、デスクトップ版が要ります。",
  "start.online.cta": "プレビューを開く",
  "start.desktop.title": "デスクトップアプリ",
  "start.desktop.body":
    "Web のクリップ、録音の文字起こし、スマホの写真や声のメモ、昔のファイルのフォルダごとの取り込みと、その検索まで、AI なしで使えます。AI を使いたくなったら、GitHub Copilot のサブスクがあれば API キーなしの 1 クリックで動き出します。macOS (Apple Silicon) / Windows 対応。",
  "start.desktop.cta": "ダウンロード",
  "start.sample.title": "実験ノートの見本",
  "start.sample.body":
    "架空の熱電材料の研究です。固相合成、XRD、ゼーベック係数の測定の記録と、そこから AI が作ったトピックが入っています。AI をつながずにブラウザで開けて、書き足しても自分のノートには混ざりません。",
  "start.sample.cta": "見本を開く",

  "faq.heading": "よくある質問",
  "faq.ai.q": "AI は必須ですか?",
  "faq.ai.a":
    "いいえ。記録を入れる、文字にする、言葉で探す、@ でつなぐところまでは AI なしで動きます。デスクトップ版が要るものもあり、Web のクリップ、録音の文字起こし、スマホの写真や声のメモの受け取りがそれです。ファイルやフォルダの取り込み、画像や PDF の文字の読み取り、検索は、ブラウザ版でも動きます。AI が要るのは、記録をトピックに束ねる、知見や洞察を取り出す、記録をもとに質問に答える、PDF や URL から手順ノートを作る、といったところです。AI を使い始めたら、API キーか GitHub Copilot のサブスクで数分でつながります。",
  "faq.connect.q": "どの AI から使えますか?",
  "faq.connect.a":
    "Graphium の中では、API キー、GitHub Copilot のサブスク、ChatGPT Plus / Pro のプラン（デスクトップ版）でつないだ AI が使えます。外からは、デスクトップ版の設定（⚙ 設定 → AI → 外の AI からノートを使う）のボタン 1 つで、Claude Desktop・Claude Code・Codex・ChatGPT のデスクトップアプリに登録できます。Cursor など、ほかの MCP 対応アシスタントには JSON を貼り付けます。ChatGPT で使えるのは、デスクトップアプリの Work モードの会話です。Chat モード・Web 版・スマホのアプリからは、パソコンの中のツールにつなげません。",
  "faq.scope.q": "AI が読む範囲は選べますか?",
  "faq.scope.a":
    "選べます。AI との会話には「渡す範囲」という切り替えが付いています。「外部参照」は Web を検索して実際に見つかった出典だけを引くよう指示され、「内部参照」はノートから蒸留された知識を横断検索し、「ノート内参照」は引用したものだけに絞る、という 3 段階です。範囲を絞るのは、引用や数値を要約ではなく原文から引くためです。",
  "faq.zettel.q": "Graphium は Zettelkasten ですか?",
  "faq.zettel.a":
    "考え方は Zettelkasten を受け継いでいます。「洞察」が permanent notes（1 ページ 1 主張・出どころまで辿れる）、「メモ」が fleeting notes（走り書き）、取り込んだ URL・論文が literature notes（文献ノート）に当たります。そして洞察を選んで編む引用ノートが structure notes（MOC）で、その「地図」はそのまま AI に渡す範囲としても働きます。違いは、候補を AI が下書きし、残すかどうかをあなたが決めること。委ねた工程はすべて辿れて、発想へ編む工程はあなたの手に残してあります。",
  "faq.data.q": "データはどこに保存されますか?",
  "faq.data.a":
    "あなたの手元です。デスクトップ版はローカルのプレーンな JSON ファイル、ブラウザ版はブラウザ内に保存されます。断りなく外部へ送ることはありません。",
  "faq.free.q": "無料ですか?",
  "faq.free.a":
    "はい。Apache 2.0 のオープンソースで、アプリは無料です。AI 機能を使うときにかかるのは、あなた自身の API キーや AI サブスクの費用だけです。",

  // ヒーローの中のコンセプトの絵（MomentsPicture）。公開済みのアプリで実際に起きることだけを描く。
  // 出どころの札は、アプリの文言（src/i18n の records.origin.*）と同じ言葉にする
  "moments.before.heading": "眠っている記録",
  "moments.before.foot": "開かないと、中身が分かりません",
  "moments.in.heading": "Graphium のノートに入れると",
  "moments.note.kind": "ノート",
  "moments.note.title": "パン教室の打ち合わせ",
  "moments.tr.heading": "文字起こし",
  "moments.tr.other": "相手",
  "moments.tr.self": "自分",
  "moments.tr.line2": "そうしましょう。まず 2°C 下げて、時間はそのままで",
  "moments.ocr.done": "テキスト抽出済み（20 文字）",
  "moments.ocr.text": "こね上げ温度 26°C\n一次発酵 60 分",
  "moments.out.heading": "探せて、辿れる。AI にも読める",
  "moments.who.self": "自分",
  "moments.photo.before": "配合表の写真",
  "moments.photo.where": "スマホから",
  "moments.photo.name": "配合表.jpg",
  "moments.photo.hit": "こね上げ温度 26°C、一次発酵 60 分",
  "moments.audio.before": "打ち合わせの録音",
  "moments.audio.where": "取り込んだファイル",
  "moments.audio.name": "パン教室の打ち合わせ.m4a",
  "moments.audio.hit": "次は、発酵の温度を先に下げてみよう",
  "moments.web.before": "読んだ Web ページ",
  "moments.web.where": "Web クリップ",
  "moments.web.name": "低温で長く発酵させると、風味が変わる理由",
  "moments.web.hit": "温度を下げると、発酵はゆっくり進みます",
  "moments.pdf.before": "昔のファイル",
  "moments.pdf.where": "取り込んだファイル",
  "moments.pdf.name": "製パンの基礎 第 3 章.pdf",
  "moments.pdf.hit": "生地の温度が 1°C 上がると、発酵は目に見えて速くなる",
  "moments.person.label": "あなた",
  "moments.query": "温度",
  "moments.placeholder": "言葉で探す",
  "moments.hits": "4 件",
  "moments.ai.label": "AI を使い始めたら",
  "moments.who.ai": "AI",
  "moments.trace.label": "つながりを辿る",
  "moments.trace.usedIn": "1 つのノートで使っています",
  "moments.trace.note.where": "録音から",
  "moments.trace.note.name": "パン教室の打ち合わせ",
  "moments.trace.topic.where": "ナレッジ化",
  "moments.trace.topic.name": "低温発酵と風味",
  "moments.trace.sources": "元の記録 3 件",
  "moments.note": "写真の文字は端末の中で読み取り、印刷された文字が対象です。録音の文字起こしと Web のクリップは、デスクトップ版で動きます。",

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
