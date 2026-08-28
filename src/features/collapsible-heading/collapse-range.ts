// 見出しを畳んだときに「どこからどこまでを隠すか」を求める純関数。
//
// Obsidian と同じ考え方で範囲を取る:
//   見出し H（level L）を畳んだら、
//     1. H の children（旧トグル見出しでネストされた中身）
//     2. H の後ろに続く兄弟ブロックのうち、次に level ≤ L の見出しが現れるまで
//   の両方を隠す。
//
// 2 を入れているのが Notion 式との違い。普通に書いた見出しは配下をネストして
// いないので、children だけを対象にすると何も畳めない。
// 1 を残しているのは、旧トグル見出し（isToggleable）で実際にネストされた
// ノートが既にあるため。両方見ることで、どちらの書き方でも畳める。
//
// ProseMirror の doc 構造（BlockNote）:
//   blockGroup > blockContainer(id) > [heading|paragraph|...] (+ blockGroup = children)

/** 隠す範囲（ProseMirror の絶対位置）と、それを畳んでいる見出しの id。 */
export interface HiddenRange {
  from: number;
  to: number;
  /** この範囲を隠している見出しブロックの id（カーソルが入ったときの展開先） */
  headingId: string;
}

/** 見出しブロック 1 つ分の位置情報（▶ を出す場所の決定に使う）。 */
export interface HeadingInfo {
  id: string;
  level: number;
  /** blockContainer の開始位置 */
  pos: number;
  /** 畳んだときに隠れるものがあるか（無ければ ▶ を出さない） */
  collapsible: boolean;
}

/** blockContainer の firstChild が見出しなら level を返す。そうでなければ null。 */
function headingLevelOf(container: any): number | null {
  const first = container?.firstChild;
  if (!first || first.type?.name !== "heading") return null;
  const level = first.attrs?.level;
  return typeof level === "number" ? level : 1;
}

/** blockContainer の子 blockGroup（= children）と、その開始位置。無ければ null。 */
function childGroupOf(container: any, containerPos: number): { node: any; pos: number } | null {
  if (!container || container.childCount < 2) return null;
  const group = container.child(1);
  if (group?.type?.name !== "blockGroup") return null;
  // container の中身は「開始タグ 1 + firstChild」の後ろから始まる
  return { node: group, pos: containerPos + 1 + container.child(0).nodeSize };
}

/** blockGroup 直下の blockContainer を位置つきで並べる。 */
function containersOf(group: any, groupPos: number): { node: any; pos: number }[] {
  const out: { node: any; pos: number }[] = [];
  group.forEach((child: any, offset: number) => {
    if (child?.type?.name === "blockContainer") {
      out.push({ node: child, pos: groupPos + 1 + offset });
    }
  });
  return out;
}

/**
 * items[i] の見出し（level）を畳んだときに隠れる兄弟の個数。
 * 次に level ≤ L の見出しが現れるまでが配下。
 */
function siblingSpan(items: { node: any }[], i: number, level: number): number {
  let j = i + 1;
  while (j < items.length) {
    const nextLevel = headingLevelOf(items[j].node);
    if (nextLevel !== null && nextLevel <= level) break;
    j++;
  }
  return j - (i + 1);
}

function walk(
  group: any,
  groupPos: number,
  collapsed: ReadonlySet<string>,
  ranges: HiddenRange[],
  headings: HeadingInfo[],
): void {
  const items = containersOf(group, groupPos);
  let i = 0;
  while (i < items.length) {
    const { node, pos } = items[i];
    const level = headingLevelOf(node);
    const id = node.attrs?.id;

    if (level !== null && typeof id === "string") {
      const inner = childGroupOf(node, pos);
      const span = siblingSpan(items, i, level);
      headings.push({ id, level, pos, collapsible: span > 0 || inner !== null });

      if (collapsed.has(id)) {
        // 1. ネストされた children をまるごと隠す
        if (inner) ranges.push({ from: inner.pos, to: inner.pos + inner.node.nodeSize, headingId: id });
        // 2. 次に level ≤ L の見出しが来るまでの兄弟を隠す
        for (let k = i + 1; k <= i + span; k++) {
          const sib = items[k];
          ranges.push({ from: sib.pos, to: sib.pos + sib.node.nodeSize, headingId: id });
        }
        // 隠した中は掘らない（外側で隠れているので二重に隠す意味がない）。
        // ただし ▶ の一覧には出したいので、隠れた見出しも収集だけしておく。
        for (let k = i + 1; k <= i + span; k++) {
          collectHeadingsOnly(items[k].node, items[k].pos, headings);
        }
        if (inner) collectHeadingsOnlyInGroup(inner.node, inner.pos, headings);
        i = i + span + 1;
        continue;
      }

      // 畳まれていない見出し: children の中を掘る
      if (inner) walk(inner.node, inner.pos, collapsed, ranges, headings);
      i++;
      continue;
    }

    // 見出し以外のブロック: children の中に畳まれた見出しがあるかもしれないので掘る
    const inner = childGroupOf(node, pos);
    if (inner) walk(inner.node, inner.pos, collapsed, ranges, headings);
    i++;
  }
}

/** 隠れている領域の中の見出しも「存在する見出し」として記録する（▶ は CSS で隠れる）。 */
function collectHeadingsOnly(container: any, pos: number, headings: HeadingInfo[]): void {
  const level = headingLevelOf(container);
  const id = container?.attrs?.id;
  if (level !== null && typeof id === "string") {
    headings.push({ id, level, pos, collapsible: false });
  }
  const inner = childGroupOf(container, pos);
  if (inner) collectHeadingsOnlyInGroup(inner.node, inner.pos, headings);
}

function collectHeadingsOnlyInGroup(group: any, groupPos: number, headings: HeadingInfo[]): void {
  for (const { node, pos } of containersOf(group, groupPos)) {
    collectHeadingsOnly(node, pos, headings);
  }
}

/**
 * 畳まれている見出し ID の集合から、隠す範囲と見出し一覧を求める。
 * 範囲は重ならない（隠した中は掘らないため）。
 */
export function analyzeDocument(
  doc: any,
  collapsed: ReadonlySet<string>,
): { ranges: HiddenRange[]; headings: HeadingInfo[] } {
  const ranges: HiddenRange[] = [];
  const headings: HeadingInfo[] = [];
  doc.forEach((child: any, offset: number) => {
    if (child?.type?.name === "blockGroup") walk(child, offset, collapsed, ranges, headings);
  });
  return { ranges, headings };
}

/** 隠す範囲だけが欲しいとき（テストと自動展開の判定用）。 */
export function computeHiddenRanges(doc: any, collapsed: ReadonlySet<string>): HiddenRange[] {
  if (collapsed.size === 0) return [];
  return analyzeDocument(doc, collapsed).ranges;
}

/** doc に実在する見出しブロックの ID を集める。 */
export function collectHeadingIds(doc: any): Set<string> {
  const ids = new Set<string>();
  doc.descendants((node: any) => {
    if (node.type?.name === "blockContainer" && headingLevelOf(node) !== null) {
      const id = node.attrs?.id;
      if (typeof id === "string") ids.add(id);
    }
    return true;
  });
  return ids;
}

/**
 * 位置 pos を隠している見出しの id。隠れていなければ null。
 * カーソルが畳んだ中に入ったときに、どれを開けばいいかを引くのに使う。
 */
export function hidingHeadingAt(ranges: readonly HiddenRange[], pos: number): string | null {
  for (const r of ranges) {
    if (pos > r.from && pos < r.to) return r.headingId;
  }
  return null;
}
