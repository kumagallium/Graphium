import { defineConfig } from 'vitepress'

// Graphium ユーザーマニュアル。GitHub Pages の /Graphium/manual/ 配下に
// deploy.yml が dist/manual/ としてコピーして公開する（アプリ本体の vite build とは独立）。
export default defineConfig({
  base: '/Graphium/manual/',
  title: 'Graphium Manual',
  description:
    'How to use Graphium — features, workflows, and reference for the AI-native notebook that keeps track of how your ideas came to be.',
  lang: 'en-US',
  lastUpdated: true,
  head: [['link', { rel: 'icon', href: '/Graphium/manual/favicon.ico' }]],
  themeConfig: {
    logo: '/logo.png',
    nav: [
      { text: 'Graphium Home', link: 'https://kumagallium.github.io/Graphium/' },
      { text: 'Open the App', link: 'https://kumagallium.github.io/Graphium/app/' },
      {
        text: 'Releases',
        link: 'https://github.com/kumagallium/Graphium/releases',
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/kumagallium/Graphium' },
    ],
    search: { provider: 'local' },
    lastUpdated: { text: 'Last updated' },
    outline: { level: [2, 3] },
    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'What is Graphium?', link: '/' },
          { text: 'Getting started', link: '/getting-started' },
        ],
      },
      {
        text: 'Core Features',
        items: [
          { text: 'Notes & editor', link: '/notes-and-editor' },
          { text: 'Labels & provenance', link: '/labels-and-provenance' },
          { text: 'Materials & citations', link: '/materials-and-citations' },
          { text: 'Knowledge layer', link: '/knowledge-layer' },
        ],
      },
      {
        text: 'AI Features',
        items: [
          { text: 'Setting up AI', link: '/ai-setup' },
          { text: 'Chat & Ask (Cmd+K)', link: '/ai-chat-and-ask' },
          { text: 'World grounding', link: '/ai-grounding' },
        ],
      },
      {
        text: 'Platforms',
        items: [
          { text: 'Desktop app', link: '/desktop-app' },
          { text: 'Mobile capture', link: '/mobile' },
          { text: 'Storage & sync', link: '/storage-and-sync' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Settings', link: '/settings' },
          { text: 'Keyboard shortcuts', link: '/shortcuts' },
          { text: 'Release history', link: '/release-history' },
        ],
      },
    ],
    footer: {
      message: 'Released under the Apache License 2.0.',
      copyright: 'Copyright © 2025-present Masaya Kumagai',
    },
  },
})
