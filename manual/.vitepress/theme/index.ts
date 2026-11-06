// VitePress 既定テーマ + Graphium ブランドトークン（custom.css）。
// レイアウトは既定のまま。色・フォント・影の上書きと、ロードマップ用の部品 2 つだけを足す。
import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import RoadmapPace from './components/RoadmapPace.vue'
import RoadmapChapters from './components/RoadmapChapters.vue'
import './custom.css'
import './roadmap.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('RoadmapPace', RoadmapPace)
    app.component('RoadmapChapters', RoadmapChapters)
  },
} satisfies Theme
