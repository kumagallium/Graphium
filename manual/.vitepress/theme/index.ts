// VitePress 既定テーマ + Graphium ブランドトークン（custom.css）。
// レイアウトは既定のまま。色・フォント・影の上書きと、ロードマップ用の部品 1 つだけを足す。
import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import RoadmapPace from './components/RoadmapPace.vue'
import RoadmapQuick from './components/RoadmapQuick.vue'
import './custom.css'
import './roadmap.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('RoadmapPace', RoadmapPace)
    app.component('RoadmapQuick', RoadmapQuick)
  },
} satisfies Theme
