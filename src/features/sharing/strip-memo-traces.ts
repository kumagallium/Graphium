// 共有コピーから、メモをたどれる値を外す。
//
// メモは共有した人の手元の下書きで、共有フォルダには渡さない。ところがノートやナレッジの本体には、
// メモの id（captureId）や、メモから写した文が次の形で入っている:
// - pages[].memoQuotes                     引用した時点のメモ本文とメモの id
// - pages[].knowledgeLinks / provLinks     `memo:<id>` を指すリンク（targetQuote に一節）
// - pages[].blocks の `@<題>`              メモを指す引用の表示。題はメモの先頭行（40 字まで）
// - wikiMeta.derivedFromNotes              `memo:<id>`（メモから作ったナレッジ）
// - wikiMeta.topicMarkdown                 `[[source:memo:<id>|一節]]` の引用
// - wikiMeta.passageContexts               メモの一節とその前後の文
// - wikiMeta.sourceCheck                   メモと照らした結果（照合済みの抜粋）
// - wikiMeta.evidenceSpan / *Frame         資料の原文をそのまま写した欄
// - documentProvenance.activities[].used   `memo:<id>`（履歴を含めて共有するときだけ残る欄）
//
// 残すもの: ノートやナレッジの本文の文章。共有すると決めた文章そのものだから。
// 受け取った側にメモは無いので、外しても読める内容は変わらない。

import type { GraphiumDocument, GraphiumPage, WikiMeta } from "../../lib/document-types";
import { SOURCE_CITATION_RE } from "../../lib/source-citations";

const MEMO_SOURCE_PREFIX = "memo:";

type LinkLike = { targetNoteId?: unknown; sourceBlockId?: unknown };
type InlineLike = { type?: string; text?: string; styles?: { textColor?: string } };
type BlockLike = { id?: string; content?: unknown; children?: BlockLike[] };

function isMemoSource(id: unknown): boolean {
  return typeof id === "string" && id.startsWith(MEMO_SOURCE_PREFIX);
}

function pointsAtMemo(link: LinkLike): boolean {
  return isMemoSource(link?.targetNoteId);
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
 * メモを指す引用の表示の文字を集める。
 * ブロックの中の `@<題>` とリンクは書いた順に 1 対 1 で並ぶので、順番で対応を取る。
 * 数が合わない（人が編集した）ブロックは、どれがメモか分からないので全部をメモ扱いにする。
 */
function collectMemoLabels(blocks: BlockLike[], links: LinkLike[]): Set<string> {
  const labels = new Set<string>();
  const memoBlockIds = new Set(links.filter(pointsAtMemo).map((l) => l.sourceBlockId));
  for (const block of flattenBlocks(blocks)) {
    if (!memoBlockIds.has(block.id)) continue;
    const shown = inlineListsOf(block).flat().filter(isCitationLabel);
    const own = links.filter((l) => l.sourceBlockId === block.id);
    shown.forEach((inline, i) => {
      if (shown.length !== own.length || pointsAtMemo(own[i])) labels.add(inline.text!);
    });
  }
  return labels;
}

function replaceLabels(block: BlockLike, labels: Set<string>, fixedLabel: string): BlockLike {
  const swap = (inline: InlineLike) =>
    isCitationLabel(inline) && labels.has(inline.text!) ? { ...inline, text: fixedLabel } : inline;
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
    ...(block.children ? { children: block.children.map((c) => replaceLabels(c, labels, fixedLabel)) } : {}),
  };
}

function stripPage(page: GraphiumPage, fixedLabel: string): GraphiumPage {
  if (!page) return page;
  const hasMemoLink = (links: unknown) => Array.isArray(links) && links.some(pointsAtMemo);
  const legacyLinks = (page as { links?: LinkLike[] }).links;
  if (
    !("memoQuotes" in page) &&
    !hasMemoLink(page.knowledgeLinks) &&
    !hasMemoLink(page.provLinks) &&
    !hasMemoLink(legacyLinks)
  ) {
    return page;
  }
  // キーごと消す（undefined を入れない）。JSON にしたとき、紐づけを持たないページと同じ形になる
  const { memoQuotes: _memoQuotes, ...rest } = page;
  const next = rest as GraphiumPage & { links?: LinkLike[] };

  // リンクを外す前に、どの表示がメモを指すかを読む
  const blocks = (page.blocks ?? []) as BlockLike[];
  const labels = collectMemoLabels(blocks, [...(page.knowledgeLinks ?? []), ...(legacyLinks ?? [])]);
  if (labels.size > 0) {
    next.blocks = blocks.map((b) => replaceLabels(b, labels, fixedLabel)) as GraphiumPage["blocks"];
  }

  if (hasMemoLink(next.knowledgeLinks)) next.knowledgeLinks = next.knowledgeLinks.filter((l) => !pointsAtMemo(l));
  if (hasMemoLink(next.provLinks)) next.provLinks = next.provLinks.filter((l) => !pointsAtMemo(l));
  if (hasMemoLink(next.links)) next.links = next.links!.filter((l) => !pointsAtMemo(l));
  return next;
}

function stripWikiMeta(meta: WikiMeta): WikiMeta {
  const fromMemo = meta.derivedFromNotes?.some(isMemoSource) ?? false;
  const hasPassage = meta.passageContexts?.some((p) => isMemoSource(p.sourceId)) ?? false;
  const checkedMemo = meta.sourceCheck?.entries?.some((e) => isMemoSource(e.sourceId)) ?? false;
  const markdown = meta.topicMarkdown?.replace(SOURCE_CITATION_RE, (raw, id: string) =>
    isMemoSource(id.trim()) ? "" : raw,
  );
  if (!fromMemo && !hasPassage && !checkedMemo && markdown === meta.topicMarkdown) return meta;

  const next: WikiMeta = { ...meta };
  if (fromMemo) {
    next.derivedFromNotes = meta.derivedFromNotes.filter((id) => !isMemoSource(id));
    // どれも資料の原文をそのまま写した欄で、どの資料の文かを持たない。メモが資料に入っていれば外す
    delete next.evidenceSpan;
    delete next.decisionFrame;
    delete next.ruleFrame;
    delete next.observationFrame;
  }
  if (hasPassage) {
    const kept = meta.passageContexts!.filter((p) => !isMemoSource(p.sourceId));
    if (kept.length > 0) next.passageContexts = kept;
    else delete next.passageContexts;
  }
  // 全体の判定はメモの結果も含めて出したものなので、一部だけ外すと判定と中身が合わなくなる。
  // 照合の結果ごと外す（受け取った側では「未照合」に見える）
  if (checkedMemo) delete next.sourceCheck;
  if (markdown !== undefined) next.topicMarkdown = markdown;
  return next;
}

/** 編集の来歴の `used` から `memo:<id>` を外す（履歴を含めて共有するときだけ本体に残る欄） */
function stripProvenance(
  provenance: GraphiumDocument["documentProvenance"],
): GraphiumDocument["documentProvenance"] {
  if (!provenance?.activities?.some((a) => a.used?.some(isMemoSource))) return provenance;
  return {
    ...provenance,
    activities: provenance.activities.map((activity) => {
      if (!activity.used?.some(isMemoSource)) return activity;
      const { used, ...rest } = activity;
      const kept = used.filter((id) => !isMemoSource(id));
      return kept.length > 0 ? { ...rest, used: kept } : rest;
    }),
  };
}

/**
 * 共有コピー用に、メモをたどれる値を落としたコピーを返す。元の doc は変更しない。
 * 外すものが無ければ、渡された doc をそのまま返す。
 */
export function stripMemoTraces(doc: GraphiumDocument): GraphiumDocument {
  const fixedLabel = doc.wikiMeta?.language?.startsWith("ja") ? "@メモ" : "@Memo";
  const pages = Array.isArray(doc.pages) ? doc.pages.map((page) => stripPage(page, fixedLabel)) : doc.pages;
  const wikiMeta = doc.wikiMeta ? stripWikiMeta(doc.wikiMeta) : doc.wikiMeta;
  const documentProvenance = stripProvenance(doc.documentProvenance);
  const pagesChanged = Array.isArray(doc.pages) && pages.some((page, i) => page !== doc.pages[i]);
  if (!pagesChanged && wikiMeta === doc.wikiMeta && documentProvenance === doc.documentProvenance) return doc;
  return {
    ...doc,
    pages,
    ...(wikiMeta ? { wikiMeta } : {}),
    ...(documentProvenance ? { documentProvenance } : {}),
  };
}
