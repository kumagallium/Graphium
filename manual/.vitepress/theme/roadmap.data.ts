// 機能ロードマップ（manual/roadmap.md・manual/ja/roadmap.md）をビルド時に読み、
// 歩みのグラフ（月ごとの節目の数と章の帯）と早見（機能名とバージョンの札）に渡す。
// 正は Markdown の表で、ここは数えて札の名前を取り出すだけ。
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
  count: number
  /** 最初と最後の節目の日付（YYYY-MM-DD） */
  from: string
  to: string
  /** 月（YYYY-MM）ごとの、この章の節目の数 */
  byMonth: Record<string, number>
}

/** 早見の札 1 枚（表の 1 行） */
export interface RoadmapItem {
  version: string
  date: string
  /** 札に出す短い名前 */
  label: string
  /** その月の目玉（`::: details` の外の行） */
  top: boolean
  /** 章の番号（1 始まり）。章の外の行は 0 */
  chapter: number
  /** 行が置かれている月の見出しの id（m-YYYY-MM や m-YYYY-MM-cont） */
  monthId: string
}

export interface RoadmapLocale {
  chapters: RoadmapChapter[]
  months: RoadmapMonth[]
  /** 表の行を文書の順に。札から行へ飛ぶときの番号はこの並びの添字 */
  items: RoadmapItem[]
  total: number
}

export type RoadmapData = Record<'en' | 'ja', RoadmapLocale>

declare const data: RoadmapData
export { data }

/** Markdown のリンク・太字・コードの記号を外して文字だけにする */
function plain(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|`|\*/g, '')
    .trim()
}

/**
 * 札の名前を節目のセルから決める。
 * 1. `<!--chip: 名前-->` があればそれ（自動の名前が長い・伝わらない行だけに書く）
 * 2. セルがリンクで始まればそのリンクの文字、太字で始まればその太字
 * 3. どちらでもなければ、最初の区切り（ — ・。・: ・. ）までの文
 */
function chipLabel(cell: string): string {
  const explicit = cell.match(/<!--\s*chip:\s*(.+?)\s*-->/)
  if (explicit) return explicit[1]
  const c = cell.trim()
  const link = c.match(/^\[([^\]]+)\]\(/)
  if (link) return plain(link[1])
  const bold = c.match(/^\*\*([^*]+)\*\*/)
  if (bold) return plain(bold[1])
  return plain(c.split(/ — |。|: |\. /)[0])
}

function parse(text: string): RoadmapLocale {
  const chapters: RoadmapChapter[] = []
  const months = new Map<string, RoadmapMonth>()
  const items: RoadmapItem[] = []
  let current: RoadmapChapter | undefined
  let monthId = ''
  let folded = false
  let total = 0

  for (const line of text.split('\n')) {
    const h2 = line.match(/^##\s+(.+?)\s*\{#(chapter-[\w-]+)\}\s*$/)
    if (h2) {
      current = { id: h2[2], title: h2[1], count: 0, from: '', to: '', byMonth: {} }
      chapters.push(current)
      continue
    }
    // 章でない h2（「早見」「要望をお寄せください」など）で章を閉じる
    if (/^##\s/.test(line)) {
      current = undefined
      continue
    }
    const h3 = line.match(/^###\s+.+\{#(m-(\d{4}-\d{2})[\w-]*)\}\s*$/)
    if (h3) {
      monthId = h3[1]
      if (!months.has(h3[2])) months.set(h3[2], { key: h3[2], id: h3[1], count: 0 })
      continue
    }
    // 畳んだ残り（::: details 〜 :::）の中の行は目玉でない
    if (/^:::\s*details\b/.test(line)) folded = true
    else if (/^:::\s*$/.test(line)) folded = false
    const row = line.match(/^\|\s*\*\*(v\d+\.\d+\.\d+)\*\*\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|(.*)\|\s*$/)
    if (row) {
      const date = row[2]
      total += 1
      items.push({
        version: row[1],
        date,
        label: chipLabel(row[3]),
        top: !folded,
        chapter: current ? chapters.length : 0,
        monthId,
      })
      const month = months.get(date.slice(0, 7))
      if (month) month.count += 1
      if (current) {
        current.count += 1
        current.byMonth[date.slice(0, 7)] = (current.byMonth[date.slice(0, 7)] ?? 0) + 1
        if (!current.from) current.from = date
        current.to = date
      }
    }
  }

  return {
    chapters,
    months: [...months.values()].sort((a, b) => a.key.localeCompare(b.key)),
    items,
    total,
  }
}

export default {
  watch: ['../../roadmap.md', '../../ja/roadmap.md'],
  load(files: string[]): RoadmapData {
    const pick = (ja: boolean) => {
      const file = files.find((f) => /[\\/]ja[\\/]roadmap\.md$/.test(f) === ja)
      return file
        ? parse(fs.readFileSync(file, 'utf8'))
        : { chapters: [], months: [], items: [], total: 0 }
    }
    return { en: pick(false), ja: pick(true) }
  },
}
