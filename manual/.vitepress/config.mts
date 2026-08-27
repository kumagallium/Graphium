import { defineConfig } from 'vitepress'

// Graphium ユーザーマニュアル。GitHub Pages の /Graphium/manual/ 配下に
// deploy.yml が dist/manual/ としてコピーして公開する（アプリ本体の vite build とは独立）。
// 英語がデフォルト、日本語は /ja/ 配下（アプリ本体の i18n 方針と同じ）。

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
      { text: 'Materials & citations', link: '/materials-and-citations' },
      { text: 'Mobile capture', link: '/mobile' },
    ],
  },
  {
    text: 'Going Further',
    items: [
      { text: 'Labels & provenance', link: '/labels-and-provenance' },
      { text: 'Setting up AI', link: '/ai-setup' },
      { text: 'Chat & Ask (Cmd+K)', link: '/ai-chat-and-ask' },
      { text: 'Knowledge layer', link: '/knowledge-layer' },
      { text: 'World grounding', link: '/ai-grounding' },
    ],
  },
  {
    text: 'Platforms & Data',
    items: [
      { text: 'Desktop app', link: '/desktop-app' },
      { text: 'Storage & sync', link: '/storage-and-sync' },
      { text: 'Connecting from Claude (MCP)', link: '/mcp-server' },
    ],
  },
  {
    text: 'Reference',
    items: [
      { text: 'Settings', link: '/settings' },
      { text: 'Keyboard shortcuts', link: '/shortcuts' },
      { text: 'FAQ', link: '/faq' },
      { text: 'Feature roadmap', link: '/roadmap' },
      { text: 'Release history', link: '/release-history' },
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
      { text: '素材と引用', link: '/ja/materials-and-citations' },
      { text: 'スマホでの記録', link: '/ja/mobile' },
    ],
  },
  {
    text: 'さらに先へ',
    items: [
      { text: 'ラベルと来歴', link: '/ja/labels-and-provenance' },
      { text: 'AI のセットアップ', link: '/ja/ai-setup' },
      { text: 'チャットと Ask (Cmd+K)', link: '/ja/ai-chat-and-ask' },
      { text: 'ナレッジ層', link: '/ja/knowledge-layer' },
      { text: '世界照合', link: '/ja/ai-grounding' },
    ],
  },
  {
    text: '環境とデータ',
    items: [
      { text: 'デスクトップアプリ', link: '/ja/desktop-app' },
      { text: '保存と同期', link: '/ja/storage-and-sync' },
      { text: 'Claude から使う (MCP)', link: '/ja/mcp-server' },
    ],
  },
  {
    text: 'リファレンス',
    items: [
      { text: '設定', link: '/ja/settings' },
      { text: 'キーボードショートカット', link: '/ja/shortcuts' },
      { text: 'よくある質問', link: '/ja/faq' },
      { text: '機能ロードマップ', link: '/ja/roadmap' },
      { text: 'リリース履歴', link: '/ja/release-history' },
    ],
  },
]

export default defineConfig({
  base: '/Graphium/manual/',
  title: 'Graphium Manual',
  description:
    'How to use Graphium — features, workflows, and reference for the AI-native notebook that keeps track of how your ideas came to be.',
  lastUpdated: true,
  head: [['link', { rel: 'icon', href: '/Graphium/manual/favicon.ico' }]],

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
    logo: '/logo.png',
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
