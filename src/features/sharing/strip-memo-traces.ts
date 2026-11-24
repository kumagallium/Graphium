// 共有コピーから、メモをたどれる値を外す。
//
// メモは共有した人の手元の下書きで、共有フォルダには渡さない。ところがノートやナレッジの本体には、
// メモの id（captureId）や、メモから写した文が次の形で入っている:
// - pages[].memoQuotes                     引用した時点のメモ本文とメモの id
// - pages[].knowledgeLinks / provLinks     `memo:<id>` を指すリンク（targetQuote に一節）
// - pages[].blocks の `@<題>`              メモを指す引用の表示。題はメモの先頭行（40 字まで）
// - wikiMeta.derivedFromNotes              `memo:<id>`（メモから作ったナレッジ）
// - wikiMeta.procedureContext              同上（手順の文脈の由来）
// - wikiMeta.topicMarkdown                 `[[source:memo:<id>|一節]]` の引用
// - wikiMeta.passageContexts               メモの一節とその前後の文
// - wikiMeta.sourceCheck                   メモと照らした結果（照合済みの抜粋）
// - wikiMeta.evidenceSpan / *Frame         資料の原文をそのまま写した欄
// - documentProvenance                     `used` の `memo:<id>` と、ブロックの全文を持つ差分
//                                          （履歴を含めて共有するときだけ本体に残る欄）
//
// 残すもの: ノートやナレッジの本文の文章。共有すると決めた文章そのものだから。
// 履歴を含めて共有するときの AI チャットは、利用者が選んで渡すものなので書き換えない。
// 受け取った側にメモは無いので、外しても読める内容は変わらない。
//
// 同じ外し方を「共有先に無い資料」にも使う（stripUnsharedSources）。共有するときに利用者が
// 「外して共有」を選んだときだけ通す（unshared-sources.ts）。トピックや回答のページは、
// 共有していないノートの一節と題をそのまま持つため（docs/internal/data-scope-design-2026-11.md の L1・L3）。

import type { GraphiumDocument, GraphiumPage, WikiMeta } from "../../lib/document-types";
import { getLocale } from "../../i18n";
import { SOURCE_CITATION_RE, parseSourceCitations } from "../../lib/source-citations";

const MEMO_SOURCE_PREFIX = "memo:";

type LinkLike = { targetNoteId?: unknown; sourceBlockId?: unknown };
/** 外す資料の id か（メモなら `memo:` で始まる id、共有していない資料なら指定した id の集合） */
type Hidden = (id: unknown) => boolean;
type InlineLike = { type?: string; text?: string; styles?: { textColor?: string } };
type BlockLike = { id?: string; content?: unknown; children?: BlockLike[] };

function isMemoSource(id: unknown): boolean {
  return typeof id === "string" && id.startsWith(MEMO_SOURCE_PREFIX);
}

function pointsAt(link: LinkLike, hidden: Hidden): boolean {
  return hidden(link?.targetNoteId);
}

function hasLinkTo(links: unknown, hidden: Hidden): boolean {
  return Array.isArray(links) && links.some((l) => pointsAt(l, hidden));
}

/** 引用の表示（青い `@<題>`）か */
function isCitationLabel(inline: InlineLike): boolean {
  return (
    inline?.type === "text" &&
    typeof inline.text === "string" &&
    inline.text.startsWith("@") &&
    inline.styles?.textColor === "blue"
  );
}

/** ブロックの中の文字の並び（段落の content と、表のセルの content）を順に返す */
function inlineListsOf(block: BlockLike): InlineLike[][] {
  const content = block.content as any;
  if (Array.isArray(content)) return [content];
  if (!Array.isArray(content?.rows)) return [];
  return content.rows.flatMap((row: any) =>
    (row?.cells ?? []).map((cell: any) => (Array.isArray(cell) ? cell : (cell?.content ?? []))),
  );
}

function flattenBlocks(blocks: BlockLike[]): BlockLike[] {
  return blocks.flatMap((block) => (block ? [block, ...flattenBlocks(block.children ?? [])] : []));
}

/**
 * どの `@<題>` を残してよいかを決める関数を返す。
 *
 * 本体にはメモの題そのものが無く、表示とリンクの対応も持たない（順番は編集でずれる）ので、
 * 「メモではないと言い切れる表示」だけを残し、ほかは固定の語にする:
 * - ブロックの表示がすべて、メモ以外へのリンクで裏づけられている → そのブロックの表示は残す
 * - メモを指すブロックや裏づけの足りないブロックでは、ほかのブロックで裏づけられた題だけを残す
 *   （参考文献の行は 1 行 1 資料なので、同じ題がそこで裏づけられる）
 * - リンク元のブロックが本文に無いメモのリンクがあるときは、どの表示か分からないので何も残さない
 */
function labelJudge(blocks: BlockLike[], textLinks: LinkLike[], allLinks: LinkLike[], hidden: Hidden) {
  const flat = flattenBlocks(blocks);
  const blockIds = new Set(flat.map((b) => b.id));
  const orphaned = allLinks.some((l) => pointsAt(l, hidden) && !blockIds.has(l.sourceBlockId as string));

  const labelsIn = (block: BlockLike) => inlineListsOf(block).flat().filter(isCitationLabel);
  const clean = new Set<string | undefined>();
  const backedLabels = new Set<string>();
  const memoLabels = new Set<string>();
  for (const block of flat) {
    const shown = labelsIn(block);
    const pointingHere = allLinks.filter((l) => l.sourceBlockId === block.id);
    const atMemo = pointingHere.filter((l) => pointsAt(l, hidden));
    if (shown.length === 1 && atMemo.length > 0 && atMemo.length === pointingHere.length) {
      memoLabels.add(shown[0].text!);
    }
    const backing = textLinks.filter((l) => l.sourceBlockId === block.id);
    if (orphaned || atMemo.length > 0 || shown.length > backing.length) continue;
    clean.add(block.id);
    for (const inline of shown) backedLabels.add(inline.text!);
  }
  return (blockId: string | undefined, text: string) =>
    clean.has(blockId) || (backedLabels.has(text) && !memoLabels.has(text));
}

function replaceLabels(
  block: BlockLike,
  keep: (blockId: string | undefined, text: string) => boolean,
  fixedLabel: string,
): BlockLike {
  const swap = (inline: InlineLike) =>
    isCitationLabel(inline) && !keep(block.id, inline.text!) ? { ...inline, text: fixedLabel } : inline;
  const swapList = (list: unknown) => (Array.isArray(list) ? list.map(swap) : list);
  const content = block.content as any;
  const nextContent = Array.isArray(content)
    ? content.map(swap)
    : Array.isArray(content?.rows)
      ? {
          ...content,
          rows: content.rows.map((row: any) => ({
            ...row,
            cells: (row?.cells ?? []).map((cell: any) =>
              Array.isArray(cell) ? swapList(cell) : { ...cell, content: swapList(cell?.content) },
            ),
          })),
        }
      : content;
  return {
    ...block,
    content: nextContent,
    ...(block.children ? { children: block.children.map((c) => replaceLabels(c, keep, fixedLabel)) } : {}),
  };
}

type StripPageOptions = {
  fixedLabel: string;
  /** ナレッジの資料に隠すものが入っているか（本文の `@` を判定し直す） */
  docUses: boolean;
  hidden: Hidden;
  /** memoQuotes を外すか（メモのときだけ） */
  dropMemoQuotes: boolean;
  /** 文書の noteLinks（`@` の裏づけの判定に足す。ページには無い） */
  docLinks?: LinkLike[];
};

function stripPage(page: GraphiumPage, opts: StripPageOptions): GraphiumPage {
  if (!page) return page;
  const { fixedLabel, docUses, hidden, dropMemoQuotes } = opts;
  const legacyLinks = (page as { links?: LinkLike[] }).links;
  const docLinks = opts.docLinks ?? [];
  const linksAtHidden =
    hasLinkTo(page.knowledgeLinks, hidden) ||
    hasLinkTo(page.provLinks, hidden) ||
    hasLinkTo(legacyLinks, hidden) ||
    hasLinkTo(docLinks, hidden);
  const hasMemoQuotes = dropMemoQuotes && "memoQuotes" in page;
  if (!hasMemoQuotes && !linksAtHidden && !docUses) return page;

  // キーごと消す（undefined を入れない）。JSON にしたとき、紐づけを持たないページと同じ形になる
  let next: GraphiumPage & { links?: LinkLike[] };
  if (hasMemoQuotes) {
    const { memoQuotes: _memoQuotes, ...rest } = page;
    next = rest as GraphiumPage & { links?: LinkLike[] };
  } else {
    next = { ...page } as GraphiumPage & { links?: LinkLike[] };
  }

  // リンクを外す前に、どの表示を残せるかを読む
  if (linksAtHidden || docUses) {
    const blocks = (page.blocks ?? []) as BlockLike[];
    // noteLinks も本文の `@` の裏づけになる（@ でつないだノートは noteLinks にも載る）。
    // knowledgeLinks と重なると裏づけが 2 本に数えられるが、隠すリンクのあるブロックは
    // 数に関係なく残さないので、表示を出す側には倒れない
    const textLinks = [...(page.knowledgeLinks ?? []), ...(legacyLinks ?? []), ...docLinks];
    const keep = labelJudge(blocks, textLinks, [...textLinks, ...(page.provLinks ?? [])], hidden);
    next.blocks = blocks.map((b) => replaceLabels(b, keep, fixedLabel)) as GraphiumPage["blocks"];
  }

  if (hasLinkTo(next.knowledgeLinks, hidden)) next.knowledgeLinks = next.knowledgeLinks.filter((l) => !pointsAt(l, hidden));
  if (hasLinkTo(next.provLinks, hidden)) next.provLinks = next.provLinks.filter((l) => !pointsAt(l, hidden));
  if (hasLinkTo(next.links, hidden)) next.links = next.links!.filter((l) => !pointsAt(l, hidden));
  return next;
}

/** このナレッジの資料にメモが入っているか */
function wikiMetaUses(meta: WikiMeta | undefined, hidden: Hidden): boolean {
  if (!meta) return false;
  return (
    (meta.derivedFromNotes?.some(hidden) ?? false) ||
    (meta.procedureContext?.derivedFromNotes?.some(hidden) ?? false) ||
    (meta.passageContexts?.some((p) => hidden(p.sourceId)) ?? false) ||
    (meta.sourceCheck?.entries?.some((e) => hidden(e.sourceId)) ?? false) ||
    parseSourceCitations(meta.topicMarkdown ?? "").some((c) => hidden(c.sourceId))
  );
}

function stripWikiMeta(meta: WikiMeta, hidden: Hidden): WikiMeta {
  if (!wikiMetaUses(meta, hidden)) return meta;

  const next: WikiMeta = { ...meta };
  if (meta.derivedFromNotes) next.derivedFromNotes = meta.derivedFromNotes.filter((id) => !hidden(id));
  if (meta.procedureContext?.derivedFromNotes) {
    next.procedureContext = {
      ...meta.procedureContext,
      derivedFromNotes: meta.procedureContext.derivedFromNotes.filter((id) => !hidden(id)),
    };
  }
  // どれも資料の原文をそのまま写した欄で、どの資料の文かを持たない。メモが資料に入っていれば外す
  delete next.evidenceSpan;
  delete next.decisionFrame;
  delete next.ruleFrame;
  delete next.observationFrame;
  if (meta.passageContexts) {
    const kept = meta.passageContexts.filter((p) => !hidden(p.sourceId));
    if (kept.length > 0) next.passageContexts = kept;
    else delete next.passageContexts;
  }
  // 全体の判定はメモの結果も含めて出したものなので、一部だけ外すと判定と中身が合わなくなる。
  // 照合の結果ごと外す（受け取った側では「未照合」に見える）
  if (meta.sourceCheck?.entries?.some((e) => hidden(e.sourceId))) delete next.sourceCheck;
  if (meta.topicMarkdown !== undefined) {
    next.topicMarkdown = meta.topicMarkdown.replace(SOURCE_CITATION_RE, (raw, id: string) =>
      hidden(id.trim()) ? "" : raw,
    );
  }
  return next;
}

/**
 * 編集の来歴から、メモをたどれる値を外す（履歴を含めて共有するときだけ本体に残る欄）。
 * 差分（contentDiff）はブロックの全文を版ごとに持ち、メモの題や削った引用の本文が過去の版に残る。
 * どの版のどの文がメモ由来かは見分けられないので、メモをたどれるページでは差分ごと渡さない。
 * 件数などの要約は残す。
 */
function stripProvenance(
  provenance: GraphiumDocument["documentProvenance"],
  usesMemo: boolean,
  hidden: Hidden,
): GraphiumDocument["documentProvenance"] {
  if (!provenance || !usesMemo) return provenance;
  return {
    ...provenance,
    activities: (provenance.activities ?? []).map((activity) => {
      if (!activity.used?.some(hidden)) return activity;
      const { used, ...rest } = activity;
      const kept = used.filter((id) => !hidden(id));
      return kept.length > 0 ? { ...rest, used: kept } : rest;
    }),
    revisions: (provenance.revisions ?? []).map((revision) => {
      if (!revision.summary || !("contentDiff" in revision.summary)) return revision;
      const { contentDiff: _contentDiff, ...summary } = revision.summary;
      return { ...revision, summary };
    }),
  };
}

/**
 * 共有コピー用に、メモをたどれる値を落としたコピーを返す。元の doc は変更しない。
 * 外すものが無ければ、渡された doc をそのまま返す。
 */
export function stripMemoTraces(doc: GraphiumDocument): GraphiumDocument {
  return stripTraces(doc, isMemoSource, { ja: "@メモ", en: "@Memo" }, { memo: true });
}

/**
 * 共有コピー用に、指定した資料（共有先に無いノート・ナレッジ・素材）をたどれる値を落とした
 * コピーを返す。外し方はメモと同じ（リンク・一節・`@<題>` の表示・照合の結果）で、加えて
 * 文書の noteLinks（つながりの線。読める写しの来歴に相手の題が出る）からも外す。
 * 元の doc は変更しない。外すものが無ければ、渡された doc をそのまま返す。
 */
export function stripUnsharedSources(doc: GraphiumDocument, ids: ReadonlySet<string>): GraphiumDocument {
  if (ids.size === 0) return doc;
  const hidden: Hidden = (id) => typeof id === "string" && ids.has(id);
  return stripTraces(
    doc,
    hidden,
    { ja: "@共有していない資料", en: "@Unshared source", ko: "@공유하지 않은 자료" },
    { memo: false },
  );
}

function stripTraces(
  doc: GraphiumDocument,
  hidden: Hidden,
  /** 置き換える `@` の語（ko を省くと英語） */
  labels: { ja: string; en: string; ko?: string },
  mode: { memo: boolean },
): GraphiumDocument {
  const pagesInDoc = Array.isArray(doc.pages) ? doc.pages : [];
  // メモは noteLinks に載らない（ノートではない）。共有していない資料は @ で noteLinks にも載る
  const docLinks = !mode.memo && Array.isArray(doc.noteLinks) ? (doc.noteLinks as LinkLike[]) : [];
  const docUses = wikiMetaUses(doc.wikiMeta, hidden);
  const uses =
    docUses ||
    hasLinkTo(docLinks, hidden) ||
    pagesInDoc.some(
      (page) =>
        !!page &&
        ((mode.memo && "memoQuotes" in page) ||
          hasLinkTo(page.knowledgeLinks, hidden) ||
          hasLinkTo(page.provLinks, hidden) ||
          hasLinkTo((page as { links?: unknown }).links, hidden)),
    ) ||
    (doc.documentProvenance?.activities?.some((a) => a.used?.some(hidden)) ?? false);
  if (!uses) return doc;

  const language = doc.wikiMeta?.language ?? getLocale();
  const fixedLabel = language.startsWith("ja")
    ? labels.ja
    : language.startsWith("ko") && labels.ko
      ? labels.ko
      : labels.en;
  const wikiMeta = doc.wikiMeta ? stripWikiMeta(doc.wikiMeta, hidden) : undefined;
  const documentProvenance = stripProvenance(doc.documentProvenance, uses, hidden);
  const pageOpts: StripPageOptions = { fixedLabel, docUses, hidden, dropMemoQuotes: mode.memo, docLinks };
  return {
    ...doc,
    pages: Array.isArray(doc.pages) ? doc.pages.map((page) => stripPage(page, pageOpts)) : doc.pages,
    ...(hasLinkTo(docLinks, hidden) ? { noteLinks: doc.noteLinks!.filter((l) => !pointsAt(l, hidden)) } : {}),
    ...(wikiMeta ? { wikiMeta } : {}),
    ...(documentProvenance ? { documentProvenance } : {}),
  };
}
