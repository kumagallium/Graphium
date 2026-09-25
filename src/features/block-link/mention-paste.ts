// コピー＆ペーストで @リンク（行き先がノート・素材の reference リンク）を運ぶ
// （メインエディタ・サイドピーク共通）。
//
// 本文の `@ラベル` は BlockNote が文字ごと貼るが、行き先のノート・素材の ID はリンクの
// 記録（linkStore）に別持ちなので、そのままでは貼った先に届かない。届かないと、貼った
// 先のクリックは名前の逆引きになり、同名の素材（試料ごとの data.txt）があると取り違える。
// コピーのときに載せた @リンクを、貼った先に実際に入った `@ラベル` の分だけ記録し直す
// （表なら貼った先の行に紐づける）。記録するものは @ メニューで入れたときと同じ:
// reference リンク、ノートなら noteLinks の派生関係、素材ならノートの引用素材。

import type { GraphiumIndex } from "../navigation/index-file";
import type { MediaIndexEntry } from "../asset-browser/media-index";
import type { GraphiumClipboardPayload, MentionLinkRecord, SerializeInput } from "../block-lifecycle/clipboard";
import { parseExternalSource } from "../network-graph/external-source";
import { tableRowIdentityOfCell } from "../../lib/table-row-identity";
import { formatWikiMentionLabel, MENTIONABLE_ASSET_TYPES } from "./mention-menu";
import {
  ensureTableRowIdentity,
  tableCellAt,
  tableCellAtCursor,
  withDerivedFromLink,
  type AddReferenceLink,
  type TableRowPosition,
  type UpdateNoteLinks,
} from "./mention-insert";

/**
 * コピーのときに buildClipboardPayload へ足す読み取り（どちらのエディタでも同じ）:
 * - 選んだ中身に、その行き先の `@ラベル` が入っているか（入っていない @リンクは運ばない）
 * - 選択が表の 1 行の中だけなら、その表とその行の identity（セルの中の文字だけを
 *   コピーしたとき、その行の @リンクだけを運ぶ）
 * @param labelOfTarget 行き先の表示名（mentionLabelResolver）
 */
export function mentionCopyContext(
  editor: any,
  labelOfTarget: (targetNoteId: string) => string | null,
): Pick<SerializeInput, "copiedRow" | "carriesMention"> {
  const selection = editor?._tiptapEditor?.state?.selection;
  // 選んだ中身の文字（セルの範囲選択なら選んだセルだけ）
  let copiedText = "";
  try {
    const content = selection?.content?.()?.content;
    if (content) copiedText = content.textBetween(0, content.size, "\n", "\n").normalize("NFC");
  } catch {
    copiedText = "";
  }
  const carriesMention = (target: string) => {
    const label = labelOfTarget(target);
    return !!label && copiedText.includes(`@${label.normalize("NFC")}`);
  };
  // セルの範囲選択（CellSelection）はセルごとに range を持ち、$from / $to は最初のセルしか
  // 指さない。全部の range の両端が同じ行にあるときだけ「1 行の中」とみなす
  const ranges: any[] = selection?.ranges ?? [];
  const cells = ranges.flatMap((r) => [tableCellAt(r?.$from), tableCellAt(r?.$to)]);
  const first = cells[0];
  if (
    !first ||
    cells.some((c) => !c || c.tableBlockId !== first.tableBlockId || c.rowIndex !== first.rowIndex)
  ) {
    return { copiedRow: null, carriesMention };
  }
  const row = editor?.getBlock?.(first.tableBlockId)?.content?.rows?.[first.rowIndex];
  return {
    copiedRow: { blockId: first.tableBlockId, rowIdentity: tableRowIdentityOfCell(row?.cells?.[0]) ?? null },
    carriesMention,
  };
}

/**
 * 行き先の表示名（本文の `@` の後ろに入る文字）を返す関数を作る。ノートは題、知見は
 * 「🤖 Concept: 題」、素材は名前。分からない行き先（URL・メモ・消えたノート等）は null
 * — 貼った先にその名前のメンションがあるかを確かめられないので運ばない。
 */
export function mentionLabelResolver(
  noteIndex: GraphiumIndex | null | undefined,
  media: ReadonlyArray<Pick<MediaIndexEntry, "fileId" | "name">> | null | undefined,
): (targetNoteId: string) => string | null {
  return (target) => {
    const ext = parseExternalSource(target);
    if (ext) {
      if (!MENTIONABLE_ASSET_TYPES.includes(ext.kind)) return null;
      return media?.find((m) => m.fileId === ext.key)?.name ?? null;
    }
    const note = noteIndex?.notes.find((n) => n.noteId === target);
    if (!note) return null;
    return note.source === "ai" ? formatWikiMentionLabel(note.wikiKind, note.title) : note.title;
  };
}

const nfc = (s: string) => s.normalize("NFC").trim();

/** インライン内容の青い `@ラベル` を集める（別のスタイルで分かれた青文字はつなげて読む） */
function collectMentionLabels(content: any[] | undefined, out: Set<string>): void {
  let run = "";
  const flush = () => {
    const text = run.trim();
    if (text.startsWith("@") && !text.startsWith("@#")) out.add(nfc(text.slice(1)));
    run = "";
  };
  for (const c of content ?? []) {
    if (c?.type === "text" && c.styles?.textColor === "blue") {
      run += c.text ?? "";
      continue;
    }
    flush();
    if (c?.type === "link" && Array.isArray(c.content)) collectMentionLabels(c.content, out);
  }
  flush();
}

const cellContent = (cell: any): any[] | undefined =>
  Array.isArray(cell) ? cell : Array.isArray(cell?.content) ? cell.content : undefined;

/** 表で identity が一致する行の位置（無ければ -1） */
function rowIndexOfIdentity(block: any, identity: string): number {
  return (block?.content?.rows ?? []).findIndex((row: any) => tableRowIdentityOfCell(row?.cells?.[0]) === identity);
}

/** 表の 1 行に入っている `@ラベル` */
function mentionLabelsInRow(block: any, rowIndex: number): Set<string> {
  const out = new Set<string>();
  for (const cell of block?.content?.rows?.[rowIndex]?.cells ?? []) collectMentionLabels(cellContent(cell), out);
  return out;
}

/** ブロックに入っている `@ラベル`（表なら全部の行） */
function mentionLabelsInBlock(block: any): Set<string> {
  if (block?.type === "table") {
    const out = new Set<string>();
    (block.content?.rows ?? []).forEach((_: any, i: number) => {
      for (const label of mentionLabelsInRow(block, i)) out.add(label);
    });
    return out;
  }
  const out = new Set<string>();
  collectMentionLabels(Array.isArray(block?.content) ? block.content : undefined, out);
  return out;
}

/** 貼った先への記録口（エディタのノートごとに違うので、呼び出し側が自分のものを渡す） */
export type MentionPasteOps = {
  addLink: AddReferenceLink;
  /** 貼る前からあるリンク（同じものを二重に足さない） */
  getAllLinks: () => ReadonlyArray<{ sourceBlockId: string; targetNoteId?: string; sourceRowIdentity?: string }>;
  /** 行き先の表示名（mentionLabelResolver） */
  labelOfTarget: (targetNoteId: string) => string | null;
  /** ノートの引用素材（citedAssetFileIds）に積む */
  citeAsset: (fileId: string) => void;
  /** ノートの noteLinks（派生関係）の書き込み口 */
  updateNoteLinks: UpdateNoteLinks;
};

/**
 * 貼り付けの後（BlockNote が中身を入れ終えてから）に、載せてきた @リンクを記録し直す。
 * - ブロックごと貼った（idMap に対応がある）: 貼られたブロックへ。表は同じ identity の行
 *   （振り直されたら rowRemap の先）へ。その行が貼られていなければ運ばない
 * - 文中に貼った（ブロックが増えていない）: カーソルのブロックへ。表ならカーソルの行へ
 * どちらも、貼った先（表なら行）に同じ `@ラベル` が実際にあるリンクだけを記録する —
 * 部分コピーで本文に入らなかったメンションのリンクを持ち込まないため。
 *
 * ノートの末尾に文中の貼り付けをすると、BlockNote が末尾に空の段落を 1 つ足すので
 * 「増えたブロック」がある（idMap がそこを指す）。そこにラベルが無く、カーソルが貼った
 * ブロックでもなければ、文中に貼ったものとして扱う。
 * @param rowRemap remintPastedRowIdentities が返す、振り直した行の対応
 * @returns 記録したリンクの数
 */
export function applyPastedMentionLinks(
  editor: any,
  payload: GraphiumClipboardPayload,
  idMap: ReadonlyMap<string, string>,
  ops: MentionPasteOps,
  rowRemap: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map(),
): number {
  const records = payload.mentionLinks ?? [];
  if (!editor || records.length === 0) return 0;

  const keyOf = (source: string, target: string, row?: string) => `${source}\u0000${target}\u0000${row ?? ""}`;
  const known = new Set<string>();
  for (const l of ops.getAllLinks()) {
    if (l.targetNoteId) known.add(keyOf(l.sourceBlockId, l.targetNoteId, l.sourceRowIdentity));
  }
  let count = 0;
  const record = (source: string, target: string, row?: string) => {
    const key = keyOf(source, target, row);
    if (known.has(key)) return;
    known.add(key);
    ops.addLink({
      sourceBlockId: source,
      targetBlockId: "",
      targetNoteId: target,
      type: "reference",
      createdBy: "human",
      ...(row ? { sourceRowIdentity: row } : {}),
    });
    const ext = parseExternalSource(target);
    if (ext) {
      if (MENTIONABLE_ASSET_TYPES.includes(ext.kind)) ops.citeAsset(ext.key);
    } else {
      ops.updateNoteLinks((links) => withDerivedFromLink(links, target, source));
    }
    count++;
  };
  const labelIn = (labels: Set<string>, target: string) => {
    const label = ops.labelOfTarget(target);
    return !!label && labels.has(nfc(label));
  };

  // ブロックごと貼った先へ。記録できたら true
  const placeInPastedBlock = (rec: MentionLinkRecord): boolean => {
    const dest = idMap.get(rec.sourceBlockId);
    const block = dest ? editor.getBlock?.(dest) : null;
    if (!dest || !block) return false;
    if (block.type === "table" && rec.sourceRowIdentity) {
      const identity = rowRemap.get(dest)?.get(rec.sourceRowIdentity) ?? rec.sourceRowIdentity;
      const rowIndex = rowIndexOfIdentity(block, identity);
      if (rowIndex < 0 || !labelIn(mentionLabelsInRow(block, rowIndex), rec.targetNoteId)) return false;
      record(dest, rec.targetNoteId, identity);
      return true;
    }
    if (!labelIn(mentionLabelsInBlock(block), rec.targetNoteId)) return false;
    record(dest, rec.targetNoteId);
    return true;
  };

  // 文中に貼った先。どのブロックから来たか分かるのは 1 ブロックからのコピーだけ。
  // カーソルが貼られたブロックの中にあるなら、ブロックごと貼ったので使わない
  // （部分コピーの表で、行の合わない @リンクをカーソルの行に付けないため）
  const inline = (() => {
    if (payload.blockIds.length !== 1) return null;
    const cursorBlock = editor.getTextCursorPosition?.()?.block;
    const dest = cursorBlock?.id ? editor.getBlock?.(cursorBlock.id) ?? cursorBlock : null;
    if (!dest?.id || [...idMap.values()].includes(dest.id)) return null;
    const cell = tableCellAtCursor(editor);
    const row: TableRowPosition | null =
      cell && cell.tableBlockId === dest.id ? { tableBlockId: cell.tableBlockId, rowIndex: cell.rowIndex } : null;
    return {
      source: payload.blockIds[0],
      blockId: dest.id as string,
      row,
      labels: row ? mentionLabelsInRow(dest, row.rowIndex) : mentionLabelsInBlock(dest),
    };
  })();

  for (const rec of records) {
    if (placeInPastedBlock(rec)) continue;
    if (!inline || rec.sourceBlockId !== inline.source || !labelIn(inline.labels, rec.targetNoteId)) continue;
    record(inline.blockId, rec.targetNoteId, inline.row ? ensureTableRowIdentity(editor, inline.row) : undefined);
  }
  return count;
}
