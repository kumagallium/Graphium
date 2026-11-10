<script setup lang="ts">
// 早見: いつ何が入ったかを、章 › 月ごとに「機能名＋バージョン」の札で並べる。
// 札は roadmap.md の表から組み立てる（roadmap.data.ts）。札を押すと下の表のその行へ飛ぶ。
// 目玉（月の最初の表の行）は色付きで常に出し、畳んだ残りは「ほか N 件」で開く。
import { computed, ref } from 'vue'
import { useData } from 'vitepress'
import { data } from '../roadmap.data'

const { localeIndex } = useData()
const ja = computed(() => localeIndex.value === 'ja')
const roadmap = computed(() => data[ja.value ? 'ja' : 'en'])

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface Chip {
  /** roadmap.items の添字（表の行の順番） */
  index: number
  version: string
  label: string
  top: boolean
  title: string
}

/** 開いている月（章の中の月の見出しの id）と、すべて開くスイッチ */
const opened = ref(new Set<string>())
const all = ref(false)

const groups = computed(() => {
  const r = roadmap.value
  // 章 › 月（見出しの id 単位。章をまたぐ月は -cont で分かれている）にまとめる
  const chapters: {
    n: number
    id: string
    title: string
    months: { id: string; label: string; chips: Chip[]; rest: number }[]
  }[] = []
  r.items.forEach((item, index) => {
    if (!item.chapter) return
    let chapter = chapters.at(-1)
    if (!chapter || chapter.n !== item.chapter) {
      const c = r.chapters[item.chapter - 1]
      chapter = { n: item.chapter, id: c.id, title: c.title, months: [] }
      chapters.push(chapter)
    }
    let month = chapter.months.at(-1)
    if (!month || month.id !== item.monthId) {
      const [y, m] = item.date.split('-').map(Number)
      month = {
        id: item.monthId,
        label: ja.value ? `${y} 年 ${m} 月` : `${EN_MONTHS[m - 1]} ${y}`,
        chips: [],
        rest: 0,
      }
      chapter.months.push(month)
    }
    if (!item.top) month.rest += 1
    month.chips.push({
      index,
      // 末尾の .0 は省く（v0.91.0 → v0.91）。パッチ版はそのまま
      version: item.version.replace(/\.0$/, ''),
      label: item.label,
      top: item.top,
      title: `${item.version} · ${item.date}`,
    })
  })
  return chapters
})

const restTotal = computed(() => roadmap.value.items.filter((i) => i.chapter && !i.top).length)

function isOpen(id: string) {
  return all.value || opened.value.has(id)
}

function toggleMonth(id: string) {
  const next = new Set(opened.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  opened.value = next
}

function toggleAll() {
  all.value = !all.value
  if (!all.value) opened.value = new Set()
}

/**
 * 表のその行へ。畳まれていれば開き、少しのあいだ色を付けて場所を示す。
 * 札の a に target="_self" を付けているのは、VitePress のルーターに href（月の見出し）への
 * スクロールをさせないため（target のあるリンクはルーターが触らない）。
 */
function jump(event: MouseEvent, index: number) {
  // 節目の行 = 1 列目が太字のバージョンだけの行。文書の順は items の順と同じ
  const rows = [...document.querySelectorAll<HTMLTableRowElement>('.roadmap-page .vp-doc tbody tr')].filter((tr) =>
    /^v\d+\.\d+\.\d+$/.test(tr.cells[0]?.textContent?.trim() ?? ''),
  )
  const row = rows[index]
  if (!row) return // 見つからなければ href（月の見出し）へ任せる
  event.preventDefault()
  const fold = row.closest('details')
  if (fold) fold.open = true
  // 遠い行まで一気に飛ぶので、なめらかに流さずその場で移す
  row.scrollIntoView({ block: 'center', behavior: 'instant' })
  row.classList.add('rm-row--found')
  window.setTimeout(() => row.classList.remove('rm-row--found'), 2400)
}

const t = computed(() =>
  ja.value
    ? {
        all: `すべて表示（ほか ${restTotal.value} 件）`,
        tops: '目玉だけにする',
        more: (n: number) => `ほか ${n} 件`,
        less: 'たたむ',
        chapters: '章ごとの早見',
      }
    : {
        all: `Show all (${restTotal.value} more)`,
        tops: 'Highlights only',
        more: (n: number) => `+${n} more`,
        less: 'Show fewer',
        chapters: 'At a glance, by chapter',
      },
)
</script>

<template>
  <section class="rm-quick" :aria-label="t.chapters">
    <p class="rm-quick__tools">
      <button type="button" class="rm-quick__toggle" :aria-pressed="all" @click="toggleAll">
        {{ all ? t.tops : t.all }}
      </button>
    </p>
    <div v-for="c in groups" :key="c.id" class="rm-quick__chapter">
      <a class="rm-quick__title" :href="`#${c.id}`">
        <span class="rm-quick__n">{{ c.n }}</span>{{ c.title }}
      </a>
      <dl>
        <template v-for="m in c.months" :key="m.id">
          <dt>
            <a :href="`#${m.id}`">{{ m.label }}</a>
          </dt>
          <dd>
            <template v-for="chip in m.chips" :key="chip.index">
              <a
                v-if="chip.top || isOpen(m.id)"
                class="rm-chip"
                :class="{ 'is-top': chip.top }"
                :href="`#${m.id}`"
                target="_self"
                :title="chip.title"
                @click="jump($event, chip.index)"
              >
                <span class="rm-chip__label">{{ chip.label }}</span>
                <span class="rm-chip__v">{{ chip.version }}</span>
              </a>
            </template>
            <button
              v-if="m.rest && !all"
              type="button"
              class="rm-chip rm-chip--more"
              :aria-expanded="isOpen(m.id)"
              @click="toggleMonth(m.id)"
            >
              {{ isOpen(m.id) ? t.less : t.more(m.rest) }}
            </button>
          </dd>
        </template>
      </dl>
    </div>
  </section>
</template>
