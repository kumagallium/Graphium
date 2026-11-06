<script setup lang="ts">
// 章カード: 章ごとにスクショ・題・期間・節目の数。押すとその章へ飛ぶ。
import { computed } from 'vue'
import { useData, withBase } from 'vitepress'
import { data } from '../roadmap.data'

const { localeIndex } = useData()
const ja = computed(() => localeIndex.value === 'ja')

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function period(from: string, to: string): string {
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  if (ja.value) {
    if (fy === ty) return fm === tm ? `${fy} 年 ${fm} 月` : `${fy} 年 ${fm}–${tm} 月`
    return `${fy} 年 ${fm} 月 – ${ty} 年 ${tm} 月`
  }
  if (fy === ty) return fm === tm ? `${EN_MONTHS[fm - 1]} ${fy}` : `${EN_MONTHS[fm - 1]}–${EN_MONTHS[tm - 1]} ${fy}`
  return `${EN_MONTHS[fm - 1]} ${fy} – ${EN_MONTHS[tm - 1]} ${ty}`
}

const cards = computed(() =>
  data[ja.value ? 'ja' : 'en'].chapters.map((c, i) => ({
    ...c,
    n: i + 1,
    src: c.image ? withBase(c.image) : undefined,
    period: period(c.from, c.to),
    count: ja.value ? `${c.count} 件` : `${c.count} milestone${c.count === 1 ? '' : 's'}`,
  })),
)
</script>

<template>
  <nav class="rm-chapters" :aria-label="ja ? '章' : 'Chapters'">
    <a v-for="c in cards" :key="c.id" class="rm-chapters__card" :href="`#${c.id}`">
      <span class="rm-chapters__thumb">
        <img v-if="c.src" :src="c.src" alt="" loading="lazy" />
      </span>
      <span class="rm-chapters__eyebrow">{{ ja ? `第 ${c.n} 章` : `Chapter ${c.n}` }} · {{ c.period }}</span>
      <span class="rm-chapters__title">{{ c.title }}</span>
      <span class="rm-chapters__count">{{ c.count }}</span>
    </a>
  </nav>
</template>
