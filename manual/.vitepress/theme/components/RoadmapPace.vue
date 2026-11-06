<script setup lang="ts">
// 歩み: 月ごとに出した節目の数を棒で並べる。押すとその月の見出しへ飛ぶ。
import { computed } from 'vue'
import { useData } from 'vitepress'
import { data } from '../roadmap.data'

const { localeIndex } = useData()
const ja = computed(() => localeIndex.value === 'ja')
const roadmap = computed(() => data[ja.value ? 'ja' : 'en'])
const max = computed(() => Math.max(1, ...roadmap.value.months.map((m) => m.count)))

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const bars = computed(() =>
  roadmap.value.months.map((m, i, all) => {
    const [y, mm] = m.key.split('-').map(Number)
    const prevYear = i > 0 ? Number(all[i - 1].key.slice(0, 4)) : undefined
    return {
      ...m,
      label: ja.value ? `${mm}月` : EN_MONTHS[mm - 1],
      year: prevYear === y ? '' : String(y),
      // 0 件の月が無いので最低でも少し見えるように
      height: Math.max(4, Math.round((m.count / max.value) * 100)),
      title: ja.value ? `${y} 年 ${mm} 月 · ${m.count} 件` : `${EN_MONTHS[mm - 1]} ${y} · ${m.count}`,
    }
  }),
)

const caption = computed(() => {
  const r = roadmap.value
  return ja.value
    ? `${r.months.length} か月で ${r.total} の節目。棒を押すとその月へ。`
    : `${r.total} milestones over ${r.months.length} months. Pick a month to jump to it.`
})
</script>

<template>
  <figure class="rm-pace">
    <ol class="rm-pace__bars" :aria-label="ja ? '月ごとの節目の数' : 'Milestones per month'">
      <li v-for="b in bars" :key="b.key">
        <a :href="`#${b.id}`" :title="b.title">
          <span class="rm-pace__plot">
            <span class="rm-pace__count">{{ b.count }}</span>
            <span class="rm-pace__bar" :style="{ height: `${b.height}%` }" />
          </span>
          <span class="rm-pace__month">{{ b.label }}</span>
          <span class="rm-pace__year">{{ b.year }}</span>
        </a>
      </li>
    </ol>
    <figcaption>{{ caption }}</figcaption>
  </figure>
</template>
