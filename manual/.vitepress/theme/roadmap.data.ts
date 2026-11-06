// 機能ロードマップ（manual/roadmap.md・manual/ja/roadmap.md）をビルド時に読み、
// 歩みのグラフ（月ごとの節目の数）と章カードに渡す。正は Markdown の表で、ここは数えるだけ。
import fs from 'node:fs'

export interface RoadmapMonth {
  /** YYYY-MM */
  key: string
  /** その月が最初に現れる見出しの id（m-YYYY-MM） */
  id: string
  count: number
}

export interface RoadmapChapter {
  id: string
  title: string
  image?: string
  count: number
  /** 最初と最後の節目の日付（YYYY-MM-DD） */
  from: string
  to: string
}

export interface RoadmapLocale {
  chapters: RoadmapChapter[]
  months: RoadmapMonth[]
  total: number
}

export type RoadmapData = Record<'en' | 'ja', RoadmapLocale>

declare const data: RoadmapData
export { data }

function parse(text: string): RoadmapLocale {
  const chapters: RoadmapChapter[] = []
  const months = new Map<string, RoadmapMonth>()
  let current: RoadmapChapter | undefined
  let total = 0

  for (const line of text.split('\n')) {
    const h2 = line.match(/^##\s+(.+?)\s*\{#(chapter-[\w-]+)\}\s*$/)
    if (h2) {
      current = { id: h2[2], title: h2[1], count: 0, from: '', to: '' }
      chapters.push(current)
      continue
    }
    // 章でない h2（「要望をお寄せください」など）で章を閉じる
    if (/^##\s/.test(line)) {
      current = undefined
      continue
    }
    const img = line.match(/^!\[[^\]]*\]\(\/screenshots\/([^)\s]+)\)/)
    if (img && current && !current.image) {
      current.image = `/screenshots/${img[1]}`
      continue
    }
    const h3 = line.match(/^###\s+.+\{#(m-(\d{4}-\d{2})[\w-]*)\}\s*$/)
    if (h3 && !months.has(h3[2])) {
      months.set(h3[2], { key: h3[2], id: h3[1], count: 0 })
      continue
    }
    const row = line.match(/^\|\s*\*\*v\d+\.\d+\.\d+\*\*\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|/)
    if (row) {
      const date = row[1]
      total += 1
      const month = months.get(date.slice(0, 7))
      if (month) month.count += 1
      if (current) {
        current.count += 1
        if (!current.from) current.from = date
        current.to = date
      }
    }
  }

  return {
    chapters,
    months: [...months.values()].sort((a, b) => a.key.localeCompare(b.key)),
    total,
  }
}

export default {
  watch: ['../../roadmap.md', '../../ja/roadmap.md'],
  load(files: string[]): RoadmapData {
    const pick = (ja: boolean) => {
      const file = files.find((f) => /[\\/]ja[\\/]roadmap\.md$/.test(f) === ja)
      return file ? parse(fs.readFileSync(file, 'utf8')) : { chapters: [], months: [], total: 0 }
    }
    return { en: pick(false), ja: pick(true) }
  },
}
