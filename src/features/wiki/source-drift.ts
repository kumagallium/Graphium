// 書いたあとで資料（ノート）から消えた一節を、ページを開いたときに見つける（AI は使わない）。
//
// トピック・問答・要約の本文は、引用ごとに「その文が言い換えた資料の一節」を控えている
// （[[source:<id>|<一節>]]）。ノートが編集されても、次に読み直すまでページは書き直されない。
// そのあいだも、引用した一節がノートにまだあるかは文字列の照合だけで確かめられる。
// ノート全体の変化（ハッシュ）ではなく一節そのものを照らすので、関係ない段落の追記や
// 誤字の修正では知らせない。
//
// 対象はノートだけ。PDF・Word は取り込んだあとで中身が差し替わらない（差し替えは別の素材になる）。
// URL は開くたびに取りに行かないので対象外。

import type { GraphiumDocument } from "../../lib/document-types";
import { SOURCE_CITATION_RE, passageAppearsIn, splitPassage } from "../../lib/source-citations";
import { parseExternalSource } from "../network-graph/external-source";
import { lastIngestedAtForSource } from "./ingest-skip";
import { passageContextChange, type PassageContextChange } from "./passage-context";

/** 書いたあとで編集され、引用した一節が消えたノート */
export type SourceDrift = {
  sourceId: string;
  /** ノートの最終更新（ページがそのノートを最後に読んだあと） */
  editedAt: string;
  /** 消えた一節と、それを引いている文 */
  gone: Array<{ statement: string; passage: string }>;
  /** 一節は残っているが、前後の文が書き換わったもの（書いたときの前後の文を控えたページだけ） */
  contextChanged: Array<{ statement: string; passage: string } & PassageContextChange>;
};

/** 本文の中で、資料 id ごとに照合済みの一節と文を集める（印の付いた一節は対象外 — もう知らせ済み） */
export function passagesBySource(markdown: string): Map<string, Array<{ statement: string; passage: string }>> {
  const out = new Map<string, Array<{ statement: string; passage: string }>>();
  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    if (!line || /^#{1,6}\s/.test(line)) continue;
    const found: Array<{ id: string; passage: string }> = [];
    const statement = line.replace(SOURCE_CITATION_RE, (_m, rawId: string, rawPassage?: string) => {
      const { passage, unverified } = splitPassage(rawPassage);
      if (passage && !unverified) found.push({ id: rawId.trim(), passage });
      return "";
    }).replace(/^[-*]\s+/, "").trim();
    for (const f of found) {
      const list = out.get(f.id) ?? [];
      list.push({ statement, passage: f.passage });
      out.set(f.id, list);
    }
  }
  return out;
}

/**
 * 確かめる対象のノートを選ぶ（本文を読まずに済む絞り込み）。
 * 一節を控えたノートのうち、ページがそのノートを最後に読んだ時刻より後に更新されたものだけ。
 * 最後に読んだ時刻はページの来歴（そのノートを used に含む活動）。無ければページの取り込み時刻。
 */
export function driftCandidates(
  doc: GraphiumDocument,
  noteModifiedAt: (noteId: string) => string | undefined,
): Array<{ sourceId: string; editedAt: string }> {
  const markdown = doc.wikiMeta?.topicMarkdown;
  if (typeof markdown !== "string") return [];
  const fallbackRead = doc.wikiMeta?.lastIngestedAt ?? doc.modifiedAt;
  const out: Array<{ sourceId: string; editedAt: string }> = [];
  for (const sourceId of passagesBySource(markdown).keys()) {
    if (parseExternalSource(sourceId)) continue; // ノート以外（pdf: / url: など）
    const editedAt = noteModifiedAt(sourceId);
    if (!editedAt) continue;
    const readAt = lastIngestedAtForSource(sourceId, [doc]) ?? fallbackRead;
    if (!readAt || new Date(editedAt).getTime() <= new Date(readAt).getTime()) continue;
    out.push({ sourceId, editedAt });
  }
  return out;
}

/** 本文が引いたあるノートの一節のうち、ノートの今の文字に無いもの */
export function passagesGoneFrom(
  markdown: string,
  sourceId: string,
  noteText: string,
): Array<{ statement: string; passage: string }> {
  return (passagesBySource(markdown).get(sourceId) ?? []).filter((p) => !passageAppearsIn(p.passage, noteText));
}

/**
 * 本文が引いたあるノートの一節のうち、一節は今のノートにあるが前後の文が書き換わったもの。
 * 前後の文は書いたときに wikiMeta.passageContexts に控えたもの。控えの無い一節は見ない。
 */
export function passagesWithChangedContext(
  doc: GraphiumDocument,
  sourceId: string,
  noteText: string,
): Array<{ statement: string; passage: string } & PassageContextChange> {
  const markdown = doc.wikiMeta?.topicMarkdown;
  const contexts = doc.wikiMeta?.passageContexts;
  if (typeof markdown !== "string" || !contexts?.length) return [];
  const stored = new Map(contexts.filter((c) => c.sourceId === sourceId).map((c) => [c.passage, c]));
  if (stored.size === 0) return [];
  const out: Array<{ statement: string; passage: string } & PassageContextChange> = [];
  const seen = new Set<string>();
  for (const p of passagesBySource(markdown).get(sourceId) ?? []) {
    const ctx = stored.get(p.passage);
    if (!ctx || seen.has(p.passage) || !passageAppearsIn(p.passage, noteText)) continue;
    const change = passageContextChange(ctx, noteText);
    if (!change) continue;
    seen.add(p.passage);
    out.push({ ...p, ...change });
  }
  return out;
}

/**
 * ページの「書いたあとで資料から消えた一節」と「前後の文が書き換わった一節」を求める。
 * readNoteText はノートの今の文字（出典照合と同じ取り出し方）。読めないノートは飛ばす
 * （ゴミ箱・削除は別の表示がある）。
 */
export async function findSourceDrift(
  doc: GraphiumDocument,
  noteModifiedAt: (noteId: string) => string | undefined,
  readNoteText: (noteId: string) => Promise<string | undefined>,
): Promise<SourceDrift[]> {
  const markdown = doc.wikiMeta?.topicMarkdown;
  if (typeof markdown !== "string") return [];
  const out: SourceDrift[] = [];
  for (const { sourceId, editedAt } of driftCandidates(doc, noteModifiedAt)) {
    const text = await readNoteText(sourceId);
    if (text === undefined) continue;
    const gone = passagesGoneFrom(markdown, sourceId, text);
    const contextChanged = passagesWithChangedContext(doc, sourceId, text);
    if (gone.length > 0 || contextChanged.length > 0) out.push({ sourceId, editedAt, gone, contextChanged });
  }
  return out;
}
