// 本文から参照が無くなった「つながり」の線を、保存のときに noteLinks から外す
// （メインエディタ・サイドピーク共通）。
//
// noteLinks には派生とつながりが同じ形で入る（lib/note-link-kind.ts）。つながりは
// 本文の @・リンクの貼り付け・表の行に既存のノートを紐付けたもので入るが、本文から
// `@タイトル` を消しても線は残っていた（@ の文字はただの青い文字で、消しても何も
// 起きない）。残った線は来歴の道具・グラフ・一覧で「つながり」として出続ける。
//
// 外すのは次をすべて満たす線だけ:
//   - つながり（相手の derivedFromNoteId がこのノートでない）。派生の線は本文に @ が
//     無くても残す（「派生」ボタン等で作った線は、本文に @ を書かないことがある）
//   - 相手がノートの一覧に載っていて、本文に入る表示名が分かる（分からなければ
//     確かめようがないので残す）
//   - 表の注釈（tableMeta.noteLinks）の行の紐付けに相手が無い
//   - 本文（表のセル・子ブロックを含む）に、相手の `@表示名` の青い文字が無い
//   - 相手への reference リンクを持つブロックに、行き先の分からない `@…` が無い
//     （改名が届かず古い名前のまま残った @ を、消えたと取り違えないため）
//
// いつ外すか: 保存が実際に書き込むときだけ（呼び出し側が no-write-on-open の比較を
// 通ったあとに呼ぶ）。開いただけのノートは書き換えない。古いデータに残った線も、
// そのノートを次に編集して保存したときに片付く。外した線は呼び出し側が控えておき、
// 取り消し（⌘Z）で `@` が戻ったら次の保存で元に戻す（restorable）。

import type { GraphiumDocument, NoteLink, TableMeta } from "../../lib/document-types";
import type { GraphiumIndex } from "../navigation/index-file";
import { noteLinkKind } from "../../lib/note-link-kind";
import { mentionLabelsInBlock } from "./mention-paste";

/** 相手ノートの一覧上の情報（一覧に無ければ null） */
export type NoteLinkTargetInfo = { derivedFromNoteId?: string } | null;

export type ConnectionCleanupInput = {
  /** このノートの ID（派生の判定に使う） */
  ownerNoteId: string;
  /** 今の noteLinks */
  noteLinks: ReadonlyArray<NoteLink>;
  /** 前の保存で外した線（本文に @ が戻っていれば戻す） */
  restorable?: ReadonlyArray<NoteLink>;
  /** 本文のブロック（保存する doc の pages[0].blocks） */
  blocks: ReadonlyArray<any>;
  /** 表の注釈（行の紐付けを読む） */
  tableMeta?: Record<string, TableMeta> | undefined;
  /** reference リンクなど、行き先を持つリンク（provLinks / knowledgeLinks） */
  links: ReadonlyArray<{ sourceBlockId: string; targetNoteId?: string }>;
  /** 行き先の本文に入る表示名（mention-paste.ts の mentionLabelResolver） */
  labelOfTarget: (targetNoteId: string) => string | null;
  /** 相手ノートの一覧上の情報。一覧に無い・一覧が古くて判定できないなら null */
  targetInfo: (targetNoteId: string) => NoteLinkTargetInfo;
};

export type ConnectionCleanupResult = {
  /** 保存する noteLinks（変わらなければ受け取った配列そのもの） */
  noteLinks: ReadonlyArray<NoteLink>;
  /** 今回外した線 */
  removed: NoteLink[];
  /** restorable から戻した線 */
  restored: NoteLink[];
};

const nfc = (s: string) => s.normalize("NFC").trim();

/** ブロックとその子孫を平らに並べる */
function flattenBlocks(blocks: ReadonlyArray<any>, out: any[] = []): any[] {
  for (const b of blocks ?? []) {
    if (!b) continue;
    out.push(b);
    if (Array.isArray(b.children) && b.children.length > 0) flattenBlocks(b.children, out);
  }
  return out;
}

/**
 * 本文から参照が無くなったつながりの線を外した noteLinks を返す。
 * 何も外さず何も戻さなければ、受け取った noteLinks をそのまま返す。
 */
export function pruneUnreferencedConnections(input: ConnectionCleanupInput): ConnectionCleanupResult {
  const { ownerNoteId, noteLinks, blocks, tableMeta, links, labelOfTarget, targetInfo } = input;
  const restorable = input.restorable ?? [];
  if (noteLinks.length === 0 && restorable.length === 0) return { noteLinks, removed: [], restored: [] };

  // 本文の `@ラベル`（ブロックごと）
  const labelsByBlock = new Map<string, Set<string>>();
  const allLabels = new Set<string>();
  for (const b of flattenBlocks(blocks)) {
    const labels = mentionLabelsInBlock(b);
    if (typeof b.id === "string") labelsByBlock.set(b.id, labels);
    for (const l of labels) allLabels.add(l);
  }

  // 表の行に紐付いたノート
  const rowLinked = new Set<string>();
  for (const meta of Object.values(tableMeta ?? {})) {
    for (const id of Object.values(meta?.noteLinks ?? {})) rowLinked.add(id);
  }

  // 行き先の分からない `@…` を持つブロックが reference リンクで指す相手（古い名前の @ かもしれない）
  const targetsByBlock = new Map<string, Set<string>>();
  for (const l of links) {
    if (!l.targetNoteId) continue;
    let set = targetsByBlock.get(l.sourceBlockId);
    if (!set) targetsByBlock.set(l.sourceBlockId, (set = new Set()));
    set.add(l.targetNoteId);
  }
  const vouched = new Set<string>();
  for (const [blockId, targets] of targetsByBlock) {
    const labels = labelsByBlock.get(blockId);
    if (!labels || labels.size === 0) continue;
    const known = new Set<string>();
    for (const t of targets) {
      const label = labelOfTarget(t);
      if (label) known.add(nfc(label));
    }
    if ([...labels].some((l) => !known.has(l))) for (const t of targets) vouched.add(t);
  }

  const isReferenced = (target: string): boolean => {
    if (rowLinked.has(target) || vouched.has(target)) return true;
    const label = labelOfTarget(target);
    return !label || allLabels.has(nfc(label));
  };
  const keep = (link: NoteLink): boolean => {
    const info = targetInfo(link.targetNoteId);
    if (!info) return true;
    if (noteLinkKind(ownerNoteId, info.derivedFromNoteId) === "derivation") return true;
    return isReferenced(link.targetNoteId);
  };

  const removed = noteLinks.filter((l) => !keep(l));
  const remaining = removed.length > 0 ? noteLinks.filter((l) => !removed.includes(l)) : [...noteLinks];
  const restored: NoteLink[] = [];
  for (const l of restorable) {
    if (remaining.some((r) => r.targetNoteId === l.targetNoteId)) continue;
    if (targetInfo(l.targetNoteId) && isReferenced(l.targetNoteId)) {
      remaining.push(l);
      restored.push(l);
    }
  }
  if (removed.length === 0 && restored.length === 0) return { noteLinks, removed, restored };
  return { noteLinks: remaining, removed, restored };
}

/**
 * ノートの一覧から相手の情報を引く関数を作る。一覧が古い版（derivedFromNoteId を
 * 写す前の v32 以前）なら派生とつながりを見分けられないので、常に null（外さない）。
 */
export function noteLinkTargetInfoResolver(
  noteIndex: GraphiumIndex | null | undefined,
): (targetNoteId: string) => NoteLinkTargetInfo {
  if (!noteIndex || noteIndex.version < 33) return () => null;
  return (target) => {
    const entry = noteIndex.notes.find((n) => n.noteId === target);
    return entry ? { derivedFromNoteId: entry.derivedFromNoteId } : null;
  };
}

/**
 * 保存する doc の noteLinks を片付ける（本文・表の注釈・リンクは doc から読む）。
 * 変わらなければ doc をそのまま返す。
 */
export function pruneDocConnections(
  doc: GraphiumDocument,
  ctx: Pick<ConnectionCleanupInput, "ownerNoteId" | "restorable" | "labelOfTarget" | "targetInfo">,
): { doc: GraphiumDocument; removed: NoteLink[]; restored: NoteLink[] } {
  const page = doc.pages?.[0];
  const noteLinks = doc.noteLinks ?? [];
  if (!page) return { doc, removed: [], restored: [] };
  const result = pruneUnreferencedConnections({
    ...ctx,
    noteLinks,
    blocks: page.blocks ?? [],
    tableMeta: page.tableMeta,
    links: [...(page.provLinks ?? []), ...(page.knowledgeLinks ?? [])],
  });
  if (result.noteLinks === noteLinks) return { doc, removed: [], restored: [] };
  return {
    doc: { ...doc, noteLinks: result.noteLinks.length > 0 ? [...result.noteLinks] : undefined },
    removed: result.removed,
    restored: result.restored,
  };
}
