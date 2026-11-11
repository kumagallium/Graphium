import { defineConfig } from 'vitepress'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// Graphium ユーザーマニュアル。GitHub Pages の /Graphium/manual/ 配下に
// deploy.yml が dist/manual/ としてコピーして公開する（アプリ本体の vite build とは独立）。
// 英語がデフォルト、日本語は /ja/ 配下（アプリ本体の i18n 方針と同じ）。

// 機能ロードマップの章（`## 題 {#chapter-N}`）をサイドバーの子項目にする。正は roadmap.md
function roadmapChapters(file: string, base: string) {
  const text = fs.readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
  return [...text.matchAll(/^##\s+(.+?)\s*\{#(chapter-(\d+))\}\s*$/gm)].map((m) => ({
    text: `${m[3]}. ${m[1]}`,
    link: `${base}#${m[2]}`,
  }))
}

const enSidebar = [
  {
    text: 'Introduction',
    items: [
      { text: 'What is Graphium?', link: '/' },
      { text: 'Getting started', link: '/getting-started' },
    ],
  },
  {
    text: 'Everyday Use',
    items: [
      { text: 'Notes & editor', link: '/notes-and-editor' },
      { text: 'Voice notes', link: '/voice-notes' },
      { text: 'Materials & citations', link: '/materials-and-citations' },
      { text: 'Mobile capture', link: '/mobile' },
      { text: 'Web clip', link: '/web-clip' },
    ],
  },
  {
    text: 'Going Further',
    items: [
      { text: 'Labels & provenance', link: '/labels-and-provenance' },
      { text: 'Using it as a lab notebook', link: '/lab-notebook' },
      { text: 'Setting up AI', link: '/ai-setup' },
      { text: 'AI usage and free tiers', link: '/ai-usage-limits' },
      { text: 'Chat & Ask (⌘K / Ctrl+K)', link: '/ai-chat-and-ask' },
      { text: 'How search works', link: '/how-search-works' },
      { text: 'Knowledge layer', link: '/knowledge-layer' },
      { text: 'World grounding', link: '/ai-grounding' },
    ],
  },
  {
    text: 'Platforms & Data',
    items: [
      { text: 'Desktop app', link: '/desktop-app' },
      { text: 'Storage & sync', link: '/storage-and-sync' },
      { text: 'Connecting an AI assistant (MCP)', link: '/mcp-server' },
    ],
  },
  {
    text: 'Reference',
    items: [
      { text: 'Settings', link: '/settings' },
      { text: 'Keyboard shortcuts', link: '/shortcuts' },
      { text: 'FAQ', link: '/faq' },
      {
        text: 'Feature roadmap',
        link: '/roadmap',
        collapsed: true,
        items: roadmapChapters('../roadmap.md', '/roadmap'),
      },
      { text: 'Release history', link: '/release-history' },
    ],
  },
  {
    text: 'Evaluations',
    collapsed: true,
    items: [
      { text: 'About these evaluations', link: '/evaluations/' },
      { text: 'Memory of the search index', link: '/evaluations/search-index-memory' },
      { text: 'What reaches the AI', link: '/evaluations/what-reaches-the-ai' },
      { text: 'Topic granularity', link: '/evaluations/topic-granularity' },
      { text: 'Merging pages by thing', link: '/evaluations/merging-pages-by-thing' },
      { text: 'Model size by feature', link: '/evaluations/model-tiers-by-feature' },
      { text: 'Checking where a plan comes from', link: '/evaluations/plan-grounding-check' },
      { text: 'Extraction accuracy by meaning', link: '/evaluations/extraction-accuracy-by-meaning' },
      { text: 'Procedures from papers', link: '/evaluations/papers-to-procedures' },
      { text: 'Memory while tidying up', link: '/evaluations/embedding-memory' },
      { text: 'Research before answering', link: '/evaluations/research-before-answering' },
      { text: 'Provenance tools', link: '/evaluations/provenance-tools' },
      { text: 'Embedding models', link: '/evaluations/embedding-models' },
      { text: 'A local model as the default', link: '/evaluations/local-models-as-default' },
      { text: 'Long sources in windows', link: '/evaluations/long-sources' },
    ],
  },
]

const jaSidebar = [
  {
    text: 'はじめに',
    items: [
      { text: 'Graphium とは', link: '/ja/' },
      { text: 'はじめる', link: '/ja/getting-started' },
    ],
  },
  {
    text: '日常の使い方',
    items: [
      { text: 'ノートとエディタ', link: '/ja/notes-and-editor' },
      { text: '音声ノート', link: '/ja/voice-notes' },
      { text: '素材と引用', link: '/ja/materials-and-citations' },
      { text: 'スマホでの記録', link: '/ja/mobile' },
      { text: 'Web クリップ', link: '/ja/web-clip' },
    ],
  },
  {
    text: 'さらに先へ',
    items: [
      { text: 'ラベルと来歴', link: '/ja/labels-and-provenance' },
      { text: '実験ノートとして使う', link: '/ja/lab-notebook' },
      { text: 'AI のセットアップ', link: '/ja/ai-setup' },
      { text: 'AI の使用量と無料枠', link: '/ja/ai-usage-limits' },
      { text: 'チャットと Ask (⌘K / Ctrl+K)', link: '/ja/ai-chat-and-ask' },
      { text: '検索のしくみ', link: '/ja/how-search-works' },
      { text: 'ナレッジ層', link: '/ja/knowledge-layer' },
      { text: '世界照合', link: '/ja/ai-grounding' },
    ],
  },
  {
    text: '環境とデータ',
    items: [
      { text: 'デスクトップアプリ', link: '/ja/desktop-app' },
      { text: '保存と同期', link: '/ja/storage-and-sync' },
      { text: 'AI アシスタントから使う (MCP)', link: '/ja/mcp-server' },
    ],
  },
  {
    text: 'リファレンス',
    items: [
      { text: '設定', link: '/ja/settings' },
      { text: 'キーボードショートカット', link: '/ja/shortcuts' },
      { text: 'よくある質問', link: '/ja/faq' },
      {
        text: '機能ロードマップ',
        link: '/ja/roadmap',
        collapsed: true,
        items: roadmapChapters('../ja/roadmap.md', '/ja/roadmap'),
      },
      { text: 'リリース履歴', link: '/ja/release-history' },
    ],
  },
  {
    text: '検証の記録',
    collapsed: true,
    items: [
      { text: 'この記録について', link: '/ja/evaluations/' },
      { text: '検索インデックスのメモリ', link: '/ja/evaluations/search-index-memory' },
      { text: 'AI に届くもの', link: '/ja/evaluations/what-reaches-the-ai' },
      { text: 'トピックの粒度', link: '/ja/evaluations/topic-granularity' },
      { text: 'もの単位にまとめる', link: '/ja/evaluations/merging-pages-by-thing' },
      { text: 'AI 機能とモデルの大きさ', link: '/ja/evaluations/model-tiers-by-feature' },
      { text: '計画の根拠の照合', link: '/ja/evaluations/plan-grounding-check' },
      { text: '意味で測り直した抽出の精度', link: '/ja/evaluations/extraction-accuracy-by-meaning' },
      { text: '論文から手順を取る', link: '/ja/evaluations/papers-to-procedures' },
      { text: '整える最中のメモリ', link: '/ja/evaluations/embedding-memory' },
      { text: 'じっくり調べてから答える', link: '/ja/evaluations/research-before-answering' },
      { text: '来歴の道具', link: '/ja/evaluations/provenance-tools' },
      { text: '埋め込みモデル', link: '/ja/evaluations/embedding-models' },
      { text: '手元のモデルを既定に', link: '/ja/evaluations/local-models-as-default' },
      { text: '長い資料を窓で読む', link: '/ja/evaluations/long-sources' },
    ],
  },
]

export default defineConfig({
  base: '/Graphium/manual/',
  title: 'Graphium Manual',
  description:
    'How to use Graphium — features, workflows, and reference for the AI-native notebook that keeps track of how your ideas came to be.',
  lastUpdated: true,
  head: [
    ['link', { rel: 'icon', href: '/Graphium/manual/favicon.ico?v=2' }],
    ['link', { rel: 'apple-touch-icon', sizes: '180x180', href: '/Graphium/manual/apple-touch-icon.png?v=2' }],
  ],

  locales: {
    root: {
      label: 'English',
      lang: 'en-US',
      themeConfig: {
        nav: [
          { text: 'Graphium Home', link: 'https://kumagallium.github.io/Graphium/' },
          { text: 'Open the App', link: 'https://kumagallium.github.io/Graphium/app/' },
          { text: 'Releases', link: 'https://github.com/kumagallium/Graphium/releases' },
        ],
        sidebar: enSidebar,
        lastUpdated: { text: 'Last updated' },
      },
    },
    ja: {
      label: '日本語',
      lang: 'ja-JP',
      link: '/ja/',
      description:
        'Graphium の使い方 — 機能・ワークフロー・リファレンス。ひらめきの出どころを辿れる AI 時代のノートアプリ。',
      themeConfig: {
        nav: [
          { text: 'Graphium ホーム', link: 'https://kumagallium.github.io/Graphium/' },
          { text: 'アプリを開く', link: 'https://kumagallium.github.io/Graphium/app/' },
          { text: 'リリース', link: 'https://github.com/kumagallium/Graphium/releases' },
        ],
        sidebar: jaSidebar,
        outline: { level: [2, 3], label: 'このページの内容' },
        lastUpdated: { text: '最終更新' },
        docFooter: { prev: '前のページ', next: '次のページ' },
        darkModeSwitchLabel: '外観',
        lightModeSwitchTitle: 'ライトモードに切り替え',
        darkModeSwitchTitle: 'ダークモードに切り替え',
        sidebarMenuLabel: 'メニュー',
        returnToTopLabel: 'トップへ戻る',
        langMenuLabel: '言語を切り替え',
      },
    },
  },

  themeConfig: {
    logo: { light: '/logo.png', dark: '/logo-light.png', alt: 'Graphium' },
    socialLinks: [{ icon: 'github', link: 'https://github.com/kumagallium/Graphium' }],
    search: {
      provider: 'local',
      options: {
        locales: {
          ja: {
            translations: {
              button: { buttonText: '検索', buttonAriaLabel: '検索' },
              modal: {
                displayDetails: '詳細を表示',
                resetButtonTitle: '検索をリセット',
                backButtonTitle: '閉じる',
                noResultsText: '見つかりませんでした',
                footer: {
                  selectText: '選択',
                  navigateText: '移動',
                  closeText: '閉じる',
                },
              },
            },
          },
        },
      },
    },
    outline: { level: [2, 3] },
    footer: {
      message: 'Released under the Apache License 2.0.',
      copyright: 'Copyright © 2025-present Masaya Kumagai',
    },
  },
})
