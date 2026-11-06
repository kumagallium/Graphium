<script setup lang="ts">
// 歩み: 月ごとに出した節目の数を、章ごとに色を分けて積んだ棒で並べる。
// 下に章の帯を敷き、どの時期がどの章かを同じ軸で見せる。棒は月へ、帯は章へ飛ぶ。
import { computed } from 'vue'
import { useData } from 'vitepress'
import { data } from '../roadmap.data'

const { localeIndex } = useData()
const ja = computed(() => localeIndex.value === 'ja')
const roadmap = computed(() => data[ja.value ? 'ja' : 'en'])

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 最初の月から最後の月まで、節目の無い月も含めて並べる */
const monthKeys = computed(() => {
  const ms = roadmap.value.months
  if (!ms.length) return []
  const keys: string[] = []
  let [y, m] = ms[0].key.split('-').map(Number)
  const last = ms[ms.length - 1].key
  for (;;) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    keys.push(key)
    if (key >= last) break
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return keys
})

const max = computed(() => Math.max(1, ...roadmap.value.months.map((m) => m.count)))

const bars = computed(() =>
  monthKeys.value.map((key, i, all) => {
    const [y, mm] = key.split('-').map(Number)
    const month = roadmap.value.months.find((m) => m.key === key)
    const count = month?.count ?? 0
    // 下から古い章の順に積む（column-reverse で並べる）
    const segments = roadmap.value.chapters
      .map((c, ci) => ({ n: ci + 1, count: c.byMonth[key] ?? 0 }))
      .filter((s) => s.count > 0)
      .map((s) => ({ ...s, share: (s.count / Math.max(1, count)) * 100 }))
    return {
      key,
      id: month?.id,
      count,
      segments,
      label: ja.value ? `${mm}月` : EN_MONTHS[mm - 1],
      year: i > 0 && all[i - 1].startsWith(String(y)) ? '' : String(y),
      height: count ? Math.max(3, Math.round((count / max.value) * 100)) : 0,
      title: ja.value ? `${y} 年 ${mm} 月 · ${count} 件` : `${EN_MONTHS[mm - 1]} ${y} · ${count}`,
    }
  }),
)

/** 日付を月の軸上の位置（0〜1）に。月の中は日割り */
function position(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const i = monthKeys.value.indexOf(`${y}-${String(m).padStart(2, '0')}`)
  const days = new Date(y, m, 0).getDate()
  return (Math.max(0, i) + (d - 1) / days) / Math.max(1, monthKeys.value.length)
}

// 章の帯: 次の章の最初の節目までを受け持ち、端の章は軸の端まで伸ばす
const bands = computed(() => {
  const cs = roadmap.value.chapters
  return cs.map((c, i) => {
    const start = i === 0 ? 0 : position(c.from)
    const end = i + 1 < cs.length ? position(cs[i + 1].from) : 1
    return {
      id: c.id,
      n: i + 1,
      title: c.title,
      left: start * 100,
      width: (end - start) * 100,
      label: ja.value ? `第 ${i + 1} 章 ${c.title}（${c.count} 件）` : `Chapter ${i + 1}: ${c.title} (${c.count})`,
    }
  })
})

const caption = computed(() => {
  const r = roadmap.value
  return ja.value
    ? `${r.months.length} か月で ${r.total} の節目。色の濃淡は章の切り替わり。棒は月へ、帯は章へ飛びます。`
    : `${r.total} milestones over ${r.months.length} months. Shades mark the chapters; pick a bar for its month or a band for its chapter.`
})
</script>

<template>
  <figure class="rm-pace">
    <ol class="rm-pace__bars" :aria-label="ja ? '月ごとの節目の数' : 'Milestones per month'">
      <li v-for="b in bars" :key="b.key">
        <component :is="b.id ? 'a' : 'span'" :href="b.id ? `#${b.id}` : undefined" :title="b.title">
          <span class="rm-pace__plot">
            <span class="rm-pace__count">{{ b.count || '' }}</span>
            <span class="rm-pace__bar" :style="{ height: `${b.height}%` }">
              <span
                v-for="s in b.segments"
                :key="s.n"
                class="rm-pace__seg"
                :class="s.n % 2 ? 'is-odd' : 'is-even'"
                :style="{ height: `${s.share}%` }"
              />
            </span>
          </span>
          <span class="rm-pace__month">{{ b.label }}</span>
          <span class="rm-pace__year">{{ b.year }}</span>
        </component>
      </li>
    </ol>
    <nav class="rm-pace__bands" :aria-label="ja ? '章' : 'Chapters'">
      <a
        v-for="c in bands"
        :key="c.id"
        :href="`#${c.id}`"
        class="rm-pace__band"
        :class="c.n % 2 ? 'is-odd' : 'is-even'"
        :style="{ left: `${c.left}%`, width: `${c.width}%` }"
        :title="c.label"
        :aria-label="c.label"
      >{{ c.n }}</a>
    </nav>
    <figcaption>{{ caption }}</figcaption>
  </figure>
</template>
