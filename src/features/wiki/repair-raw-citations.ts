// 本文に生のまま残った引用 `[[題]]` を、@リンクへ戻す（読み込みのたびに冪等に直す）。
//
// 題に `[` `]` を含む資料（「[第三部] …」など）の引用は、v0.173.8 までの読み取り
// （wiki-service.ts の parseInlineCitations）が拾えず、`[[[第三部] …]]` の文字のまま
// ページに保存されていた。読み取りは直したが、すでに作られたページは作り直すまで
// 生の文字が残る。そこで読み込み時（document-migration.ts の migrateToLatest）に直す。
//
// - 手がかりは同じページの References。References の各行は「@題」の青文字と、その行から
//   資料へのリンク記録（knowledgeLinks）を持つので、題 → 資料 id が分かる
//   （ノート一覧が無くても直せる。References に無い資料の引用は直さず、文字のまま残す）
// - 直した引用には、作り直したときと同じ形のリンク記録（type: reference / layer: knowledge）
//   を足す。ファイルは書き換えない。次に保存されたときに、直した形で書き込まれる
// - ナレッジページ（wikiMeta を持つ文書）だけが対象。普通のノートの `[[…]]` には触らない

import type { GraphiumDocument } from "../../lib/document-types";

/** 引用 1 つ。題の途中の `]` と、`]` で終わる題を許す（parseInlineCitations と同じ規則） */
const RAW_CITATION_RE = /\[\[((?:[^\]]|\](?!\])|\](?=\]\](?!\])))+?)\]\](?!\])/g;

/** 書いた AI に写させた一節の目印（wiki-service.ts の PASSAGE_MARK_RE と同じ形）。生の文字に残っていたら外す */
const PASSAGE_MARK_RE = /⟦P:\d+⟧/g;

/** 作り直したときと同じ「@題」の見た目 */
const MENTION_STYLES = { textColor: "blue" } as const;

type Target = { label: string; targetNoteId: string };

function isBlue(item: any): boolean {
  return item?.type === "text" && item.styles?.textColor === "blue";
}

/** 文書順にすべてのブロックを返す（段組みなどの子も含む） */
function allBlocks(blocks: any[]): any[] {
  const out: any[] = [];
  const walk = (list: any[]) => {
    for (const b of list ?? []) {
      if (!b || typeof b !== "object") continue;
      out.push(b);
      if (Array.isArray(b.children)) walk(b.children);
    }
  };
  walk(blocks);
  return out;
}

function headingText(block: any): string {
  if (!Array.isArray(block.content)) return "";
  return block.content.map((c: any) => (typeof c?.text === "string" ? c.text : "")).join("").trim();
}

/** References の各行から、題 → 資料（表示ラベルとリンク先）を集める */
function collectReferenceTargets(blocks: any[], links: any[]): Map<string, Target> {
  const targets = new Map<string, Target>();
  const flat = allBlocks(blocks);
  const start = flat.findIndex((b) => b.type === "heading" && headingText(b) === "References");
  if (start < 0) return targets;
  const level = Number(flat[start].props?.level) || 1;
  for (let i = start + 1; i < flat.length; i++) {
    const b = flat[i];
    if (b.type === "heading" && (Number(b.props?.level) || 1) <= level) break;
    if (!Array.isArray(b.content)) continue;
    const mentions = b.content.filter(isBlue).map((c: any) => String(c.text).trim()).filter((t: string) => t.startsWith("@"));
    const linkTargets = new Set(
      links.filter((l) => l?.sourceBlockId === b.id && typeof l.targetNoteId === "string" && l.targetNoteId).map((l) => l.targetNoteId as string),
    );
    // 1 行に @題 が 1 つ・リンク先が 1 つのときだけ対応が決まる
    if (mentions.length !== 1 || linkTargets.size !== 1) continue;
    const label = mentions[0];
    const targetNoteId = [...linkTargets][0];
    // ナレッジページの引用は「@🤖 題」で出るが、本文の生の引用は題だけ
    const title = label.slice(1).replace(/^🤖\s*/u, "").trim();
    if (title && !targets.has(title)) targets.set(title, { label, targetNoteId });
  }
  return targets;
}

/** 1 つの text 要素を、直せる引用ごとに分けた要素列と、足すリンク先の一覧にする */
function splitRawCitations(item: any, targets: Map<string, Target>): { parts: any[]; added: string[] } | null {
  const text: string = item.text;
  if (!text.includes("[[")) return null;
  const parts: any[] = [];
  const added: string[] = [];
  let last = 0;
  for (const m of text.matchAll(RAW_CITATION_RE)) {
    const title = m[1].replace(PASSAGE_MARK_RE, "").trim();
    const target = targets.get(title);
    if (!target) continue;
    const at = m.index ?? 0;
    if (at > last) parts.push({ ...item, text: text.slice(last, at) });
    parts.push({ type: "text", text: target.label, styles: { ...MENTION_STYLES } });
    added.push(target.targetNoteId);
    last = at + m[0].length;
  }
  if (added.length === 0) return null;
  if (last < text.length) parts.push({ ...item, text: text.slice(last) });
  return { parts, added };
}

function newLinkId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `link-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * ナレッジページの本文に生のまま残った `[[題]]` を、References で分かる資料への @リンクに戻す
 * （破壊的に変更する。直すものが無ければ何もしない）
 */
export function repairRawTitleCitations(doc: GraphiumDocument): void {
  if (!doc?.wikiMeta) return;
  for (const page of doc.pages ?? []) {
    const blocks = page?.blocks;
    if (!Array.isArray(blocks)) continue;
    const links: any[] = Array.isArray(page.knowledgeLinks) ? page.knowledgeLinks : [];
    const targets = collectReferenceTargets(blocks, links);
    if (targets.size === 0) continue;
    const newLinks: any[] = [];
    for (const block of allBlocks(blocks)) {
      if (!Array.isArray(block.content)) continue;
      let changed = false;
      const next: any[] = [];
      for (const item of block.content) {
        const split = item?.type === "text" && !isBlue(item) && typeof item.text === "string"
          ? splitRawCitations(item, targets)
          : null;
        if (!split) {
          next.push(item);
          continue;
        }
        changed = true;
        next.push(...split.parts);
        for (const targetNoteId of split.added) {
          newLinks.push({
            id: newLinkId(),
            sourceBlockId: block.id,
            targetBlockId: "",
            targetNoteId,
            type: "reference",
            layer: "knowledge",
            createdBy: "ai",
          });
        }
      }
      if (changed) block.content = next;
    }
    if (newLinks.length > 0) page.knowledgeLinks = [...links, ...newLinks];
  }
}
