// 「もの単位にまとめる」の機械的な組分け（純関数。AI は使わない）。
//
// 「ライ麦サワー種の発酵時間」「ライ麦サワー種の酸度」のように、同じものについてのページが
// 性質ごとに分かれているとき、題が「X の Y」の形であることだけを手がかりに、X ごとの組を作る。
// 日本語の「の」の題だけが対象（英語の "X of Y" / "X lattice constant" は何もしない）。
// 実際のまとめは mergeTopicsFromSelection が行う。本文は AI を使わず機械的に連結する
// （composeThingBody。性質ごとの内容を要約で落とさないため）。ここは組と節の見出しを決めるだけ。

import { topicTitleParts } from "../../lib/topic-title-key";

export type ThingGroupTopic = { id: string; title: string; sourceCount: number };

export type ThingGroup = {
  /** まとめ先の題（X） */
  thing: string;
  /** 残す側 */
  keepId: string;
  /** 残す側の題を thing に付け替えるか（X という題のページが無い組） */
  retitle: boolean;
  /** 吸収される側（残す側を除く） */
  absorbIds: string[];
  /** 本文を連結する順（残す側を含む）。heading は節の見出し（Y）。残す側が X のページなら null（先頭にそのまま置く） */
  sections: { id: string; heading: string | null }[];
  /** 表示用（「X の Y」のページの題。残す側が「X の Y」ならそれも含む） */
  memberTitles: string[];
};

/** X の最小の長さ（コードポイント数）。短い語は別のものを巻き込みやすいので対象にしない */
export const THING_GROUP_MIN_THING_LENGTH = 3;

const OF_PATTERN = /^(.+?)\s*の\s*(.+)$/;

type Parsed = { topic: ThingGroupTopic; index: number; x: string; key: string };

/** 「X の Y」の形か。形に合えば X（NFKC・trim 済み）を返す。X が短すぎる場合は valid: false */
function parseOf(title: string): { x: string; valid: boolean } | null {
  const m = OF_PATTERN.exec(title.normalize("NFKC"));
  if (!m) return null;
  const x = m[1].trim();
  if (x === "") return null;
  return { x, valid: [...x].length >= THING_GROUP_MIN_THING_LENGTH };
}

/** 元の表記の題「X の Y」から Y を切り出す（NFKC 前の表記のまま）。切り出せなければ題そのまま */
function extractHeading(title: string): string {
  const m = OF_PATTERN.exec(title);
  const y = m?.[2].trim();
  return y ? y : title;
}

/** 最大 sourceCount のもの（同点は入力順で先） */
function pickMostSources<T extends { topic: ThingGroupTopic }>(items: T[]): T {
  let best = items[0];
  for (const it of items) if (it.topic.sourceCount > best.topic.sourceCount) best = it;
  return best;
}

export function planThingGroups(topics: ThingGroupTopic[]): ThingGroup[] {
  const membersByKey = new Map<string, Parsed[]>();
  const plainByKey = new Map<string, { topic: ThingGroupTopic; index: number }[]>();

  topics.forEach((topic, index) => {
    const parsed = parseOf(topic.title);
    if (parsed) {
      // 「X の Y」の形。X が短いものは組にしない（X のページにもならない）
      if (!parsed.valid) return;
      const key = topicTitleParts(parsed.x).base;
      if (key === "") return;
      const list = membersByKey.get(key) ?? [];
      list.push({ topic, index, x: parsed.x, key });
      membersByKey.set(key, list);
    } else {
      // 「X の Y」の形でないもの = X のページの候補（末尾の括弧書きは base で無視される）
      const key = topicTitleParts(topic.title).base;
      if (key === "") return;
      const list = plainByKey.get(key) ?? [];
      list.push({ topic, index });
      plainByKey.set(key, list);
    }
  });

  const groups: ThingGroup[] = [];
  for (const [key, members] of membersByKey) {
    const xPages = plainByKey.get(key) ?? [];
    if (!(members.length >= 2 || (xPages.length >= 1 && members.length >= 1))) continue;

    let keepId: string;
    let retitle: boolean;
    let thing: string;
    if (xPages.length >= 1) {
      const keep = pickMostSources(xPages);
      keepId = keep.topic.id;
      retitle = false;
      thing = keep.topic.title;
    } else {
      keepId = pickMostSources(members).topic.id;
      retitle = true;
      // その組で一番多い X の表記（同数なら最初のもの）
      const counts = new Map<string, number>();
      for (const m of members) counts.set(m.x, (counts.get(m.x) ?? 0) + 1);
      let bestX = members[0].x;
      let bestCount = 0;
      for (const [x, c] of counts) {
        if (c > bestCount) { bestX = x; bestCount = c; }
      }
      thing = bestX;
    }

    // 節の順: 残す側（先頭）→ 吸収側を題の文字列順。同じ見出しは 2 つ目以降に番号を付ける
    const absorbsInOrder = members.filter((m) => m.topic.id !== keepId);
    const absorbs = [...absorbsInOrder].sort((a, b) => (a.topic.title < b.topic.title ? -1 : a.topic.title > b.topic.title ? 1 : 0));
    const keepMember = members.find((m) => m.topic.id === keepId);
    const rawSections: { id: string; heading: string | null }[] = [
      { id: keepId, heading: retitle && keepMember ? extractHeading(keepMember.topic.title) : null },
      ...absorbs.map((m) => ({ id: m.topic.id, heading: extractHeading(m.topic.title) as string | null })),
    ];
    const seen = new Map<string, number>();
    const sections = rawSections.map((sec) => {
      if (sec.heading === null) return sec;
      const n = (seen.get(sec.heading) ?? 0) + 1;
      seen.set(sec.heading, n);
      return n === 1 ? sec : { ...sec, heading: `${sec.heading}（${n}）` };
    });

    groups.push({
      thing,
      keepId,
      retitle,
      absorbIds: absorbsInOrder.map((m) => m.topic.id),
      sections,
      memberTitles: members.map((m) => m.topic.title),
    });
  }

  groups.sort((a, b) => {
    if (b.absorbIds.length !== a.absorbIds.length) return b.absorbIds.length - a.absorbIds.length;
    return a.thing < b.thing ? -1 : a.thing > b.thing ? 1 : 0;
  });
  return groups;
}

/**
 * 本文の見出しを、節の見出し（##）の下に収まるように下げる。ふつうは 1 段（## → ###）。
 * 本文に # の見出しが混じっているときは、いちばん上の見出しが ### になるだけ下げる
 * （1 段だけだと、その見出しが節と同じ ## に並んでしまう）。6 段目より下には下げない。
 * ``` で囲まれたコードブロックの中は触らない
 */
function demoteHeadings(body: string): string {
  const lines = body.split("\n");
  const levels: (number | null)[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^ {0,3}```/.test(line)) {
      inFence = !inFence;
      levels.push(null);
      continue;
    }
    const m = inFence ? null : /^(#{1,6})(?=\s)/.exec(line);
    levels.push(m ? m[1].length : null);
  }
  const top = Math.min(...levels.filter((l): l is number => l !== null), 6);
  const shift = Math.max(1, 3 - top);
  return lines
    .map((line, i) => {
      const level = levels[i];
      if (level === null) return line;
      return "#".repeat(Math.min(6, level + shift)) + line.slice(level);
    })
    .join("\n");
}

/**
 * 組の本文を機械的に連結する（AI は使わない・文字は落とさない）。
 * heading が null の本文はそのまま（見出しも下げない）、それ以外は「## heading」の節にして
 * 本文の見出しを 1 段下げる。空の本文は節ごと省く。
 */
export function composeThingBody(parts: { heading: string | null; body: string }[]): string {
  const chunks: string[] = [];
  for (const { heading, body } of parts) {
    if (body.trim() === "") continue;
    if (heading === null) {
      chunks.push(body.replace(/\s+$/, ""));
    } else {
      chunks.push(`## ${heading}\n\n${demoteHeadings(body).replace(/^\s*\n/, "").replace(/\s+$/, "")}`);
    }
  }
  return chunks.length > 0 ? `${chunks.join("\n\n")}\n` : "";
}
