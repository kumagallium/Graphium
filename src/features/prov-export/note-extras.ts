// ──────────────────────────────────────────────
// ノートの PROV 書き出しに渡す付属情報の収集（純関数）
//
// doc（保存済みノート）・メモ一覧・素材の索引・計画の表から、buildNoteProvJsonLd の
// 入力 NoteProvExtras を作る。I/O（ファイルや索引の読み込み）は呼び出し側が済ませて渡す。
// DOM / React / Node 固有 API に依存しない（MCP サーバーの Node からも呼ぶ）。
// ──────────────────────────────────────────────

import type { GraphiumDocument, TableSource } from "../../lib/document-types";
import type { BlockLink } from "../block-link/link-types";
import type { CaptureIndex } from "../mobile-capture/capture-store";
import type { MediaIndexEntry } from "../asset-browser/media-index";
import type { GraphiumIndex } from "../navigation/index-file";
import { splitMemoBodyAndSource } from "../mobile-capture/memo-insert";
import { collectOperationRows, findPlanNotesOf, normalizeOperationName } from "../network-graph/plan-flow";
import type {
  AssetExportEntry,
  ChatExportEntry,
  MemoExportEntry,
  NoteProvExtras,
} from "./note-export";
import { stripDocKeyPrefix } from "./note-export";
import { collectQuoteBlockIds, liveMemoQuoteEntries } from "../memo-quote/memo-quote";
import type { WikiEntityInfo } from "./export-jsonld";

export type CollectNoteProvExtrasInput = {
  doc: GraphiumDocument;
  noteId: string;
  /** メモ（captures.json）。無ければメモは出さない */
  captureIndex?: CaptureIndex | null;
  /** 素材の索引。配列でも fileId → エントリの Map でもよい */
  mediaIndex?: MediaIndexEntry[] | Map<string, MediaIndexEntry> | null;
  /** 知見リンクの表示名（title）を引くために使う */
  wikiEntities?: WikiEntityInfo[];
  /** 書き出す人（メモ・チャットの Agent に使う） */
  identity?: { name?: string; email?: string };
  /** 計画の線の名前（実績）を引くための材料。無ければ edgeLabelForLink は作らない */
  planContext?: {
    index: GraphiumIndex | null;
    /** 計画ノート ID → 計画ノートの doc */
    planDocs: Map<string, GraphiumDocument>;
  };
};

/** media-server:// / file-media:// / local-media:// から fileId を取り出す（既定の resolveFileId） */
const MEDIA_URL_RE = /^(?:media-server|file-media|local-media):\/\/([^?#]+)/;

function defaultResolveFileId(url: string): string | null {
  const m = MEDIA_URL_RE.exec(url);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

function toMediaMap(index: CollectNoteProvExtrasInput["mediaIndex"]): Map<string, MediaIndexEntry> {
  if (!index) return new Map();
  if (index instanceof Map) return index;
  return new Map(index.map((e) => [e.fileId, e]));
}

function toAssetEntry(e: MediaIndexEntry): AssetExportEntry {
  return {
    fileId: e.fileId,
    type: e.type,
    ...(e.name ? { name: e.name } : {}),
    ...(e.url ? { url: e.url } : {}),
    ...(e.mimeType ? { mimeType: e.mimeType } : {}),
    ...(e.sourceInfo ? { sourceInfo: e.sourceInfo } : {}),
  };
}

/**
 * doc とその周辺の索引から NoteProvExtras を集める。
 *
 * - sources: sourceUrl→url / sourcePdfFileId→pdf / sourceDocumentFileId→document /
 *   sourceTextFileId→text / derivedFromNoteId→note / templateFrom→template /
 *   forkedFrom→shared / importSource→import
 * - influences: citedAssetFileIds→asset / 先頭ページの knowledgeLinks→wiki
 * - memos: archived / deleted を除く。このノートのメモ、このノートが参照する素材のメモ、
 *   このノートに挿入済みのメモ
 * - assets: ノートが参照する素材（引用・出典・メディアの使用・メモの出典素材）のうち索引にあるもの
 * - tableMeta / chats / folders / partOfPlanNoteId / modifiedAt は doc からそのまま
 *
 * 仕様の「noteLinks(derived_from)→note」は取り込まない: noteLinks は「このノートから作った子ノート」
 * （工程の行ノートなど）への参照で、向きが wasDerivedFrom と逆になるため。親は derivedFromNoteId で出る。
 */
export function collectNoteProvExtras(input: CollectNoteProvExtrasInput): NoteProvExtras {
  const { doc, noteId } = input;
  const page = doc.pages?.[0];
  const media = toMediaMap(input.mediaIndex);
  const extras: NoteProvExtras = {};

  // ── 時刻・フォルダ・計画への所属 ──
  if (doc.modifiedAt) extras.modifiedAt = doc.modifiedAt;
  const folders = (doc.noteContexts ?? []).filter((f) => typeof f === "string" && f.trim() !== "");
  if (folders.length > 0) extras.folders = folders;
  if (doc.partOfPlanNoteId) extras.partOfPlanNoteId = doc.partOfPlanNoteId;

  // ── 出典・派生元 ──
  const sources: NonNullable<NoteProvExtras["sources"]> = [];
  if (doc.sourceUrl) {
    sources.push({ kind: "url", id: doc.sourceUrl, ...(doc.sourceTitle ? { label: doc.sourceTitle } : {}) });
  }
  if (doc.sourcePdfFileId) {
    sources.push({ kind: "pdf", id: doc.sourcePdfFileId, ...(doc.sourcePdfName ? { label: doc.sourcePdfName } : {}) });
  }
  if (doc.sourceDocumentFileId) {
    sources.push({
      kind: "document",
      id: doc.sourceDocumentFileId,
      ...(doc.sourceDocumentName ? { label: doc.sourceDocumentName } : {}),
    });
  }
  if (doc.sourceTextFileId) sources.push({ kind: "text", id: doc.sourceTextFileId });
  if (doc.derivedFromNoteId) sources.push({ kind: "note", id: doc.derivedFromNoteId });
  const tpl = doc.templateFrom;
  const tplId = tpl?.sharedId ?? tpl?.userTemplateId ?? tpl?.officialTemplateId;
  if (tpl && tplId) sources.push({ kind: "template", id: tplId, ...(tpl.title ? { label: tpl.title } : {}) });
  if (doc.forkedFrom?.sharedId) sources.push({ kind: "shared", id: doc.forkedFrom.sharedId });
  if (doc.importSource?.contentHash) {
    sources.push({
      kind: "import",
      id: doc.importSource.contentHash,
      ...(doc.importSource.path ? { label: doc.importSource.path } : {}),
    });
  }
  // 同じ (kind, id) は 1 つに
  const seenSource = new Set<string>();
  const uniqueSources = sources.filter((s) => {
    const key = `${s.kind}\u0000${s.id}`;
    if (seenSource.has(key)) return false;
    seenSource.add(key);
    return true;
  });
  if (uniqueSources.length > 0) extras.sources = uniqueSources;

  // ── 影響（@ 引用した素材・知識層リンク）──
  const influences: NonNullable<NoteProvExtras["influences"]> = [];
  for (const fileId of doc.citedAssetFileIds ?? []) {
    const entry = media.get(fileId);
    influences.push({
      kind: "asset",
      id: fileId,
      ...(entry?.type ? { type: entry.type } : {}),
      ...(entry?.name ? { label: entry.name } : {}),
    });
  }
  const seenWiki = new Set<string>();
  for (const link of page?.knowledgeLinks ?? []) {
    const target = link.targetNoteId;
    if (!target || target === noteId || seenWiki.has(target)) continue;
    seenWiki.add(target);
    const label = link.targetNoteTitle || input.wikiEntities?.find((w) => w.id === target)?.title;
    influences.push({ kind: "wiki", id: target, ...(label ? { label } : {}) });
  }
  if (influences.length > 0) extras.influences = influences;

  // ── 表の名前と取り込み元 ──
  const tableMeta: NonNullable<NoteProvExtras["tableMeta"]> = {};
  for (const [blockId, meta] of Object.entries(page?.tableMeta ?? {})) {
    const caption = meta?.caption?.trim();
    const source: TableSource | undefined = meta?.source;
    if (!caption && !source) continue;
    tableMeta[blockId] = { ...(caption ? { caption } : {}), ...(source ? { source } : {}) };
  }
  if (Object.keys(tableMeta).length > 0) extras.tableMeta = tableMeta;

  // ── チャット ──
  const chats: ChatExportEntry[] = (doc.chats ?? [])
    .filter((c) => (c.messages?.length ?? 0) > 0)
    .map((c) => ({
      id: c.id,
      ...(c.scopeBlockId ? { scopeBlockId: c.scopeBlockId } : {}),
      scopeType: c.scopeType,
      ...(c.generatedBy?.model ? { model: c.generatedBy.model } : {}),
      messages: c.messages.map((m) => ({ role: m.role, content: m.content, timestamp: m.timestamp })),
    }));
  if (chats.length > 0) extras.chats = chats;

  // ── 素材（ノートが参照するもの）──
  const ownKey = stripDocKeyPrefix(noteId);
  // 1 パス目: ノートが参照する素材だけで確定する（メモの採否に使う）
  const referenced = new Set<string>();
  for (const id of doc.citedAssetFileIds ?? []) referenced.add(id);
  for (const id of [doc.sourcePdfFileId, doc.sourceDocumentFileId, doc.sourceTextFileId]) {
    if (id) referenced.add(id);
  }
  for (const [fileId, entry] of media) {
    if (entry.usedIn?.some((u) => stripDocKeyPrefix(u.noteId) === ownKey)) referenced.add(fileId);
  }

  // ── メモ（archived / deleted は除く）──
  // 2 パス目: referenced は動かさない（captures の並び順に依存させない）。
  // 採用メモの出典素材は assets 用の別集合に入れる
  const extraAssets = new Set<string>();
  const memos: MemoExportEntry[] = [];
  // 本文の引用ブロック（memoQuotes）に紐づいているメモ。このノートに挿入されたメモとして拾う
  // （usedIn が無い古い /memo ピッカー挿入分でも、新しく紐づけたものは拾える）。
  // 本文に引用ブロックが無いもの（消した・段落などに変えた）は除く
  const quotedMemoIds = new Set(
    liveMemoQuoteEntries(page?.memoQuotes, collectQuoteBlockIds(page?.blocks ?? [])).map(([, ref]) => ref.captureId),
  );
  for (const c of input.captureIndex?.captures ?? []) {
    if (c.archivedAt || c.deletedAt) continue;
    const usedInThisNote =
      (c.usedIn ?? []).some((u) => stripDocKeyPrefix(u.noteId) === ownKey) || quotedMemoIds.has(c.id);
    const ownNote = !!c.sourceNote && stripDocKeyPrefix(c.sourceNote.fileId) === ownKey;
    const ofReferencedAsset = !!c.sourceAsset && referenced.has(c.sourceAsset.fileId);
    if (!usedInThisNote && !ownNote && !ofReferencedAsset) continue;
    memos.push({
      id: c.id,
      text: c.text,
      createdAt: c.createdAt,
      ...(c.modifiedAt ? { modifiedAt: c.modifiedAt } : {}),
      edited: (c.editHistory?.length ?? 0) > 0,
      ...(c.createdBy ? { createdBy: c.createdBy } : {}),
      ...(c.sourceNote
        ? {
            sourceNote: {
              fileId: c.sourceNote.fileId,
              ...(c.sourceNote.blockId ? { blockId: c.sourceNote.blockId } : {}),
              ...(c.sourceNote.blockText ? { blockText: c.sourceNote.blockText } : {}),
            },
          }
        : {}),
      ...(c.sourceEdge
        ? {
            sourceEdge: {
              graph: c.sourceEdge.graph,
              from: c.sourceEdge.from,
              to: c.sourceEdge.to,
              ...(c.sourceEdge.fromLabel ? { fromLabel: c.sourceEdge.fromLabel } : {}),
              ...(c.sourceEdge.toLabel ? { toLabel: c.sourceEdge.toLabel } : {}),
            },
          }
        : {}),
      ...(c.sourceAsset
        ? {
            sourceAsset: {
              fileId: c.sourceAsset.fileId,
              type: c.sourceAsset.type,
              ...(typeof c.sourceAsset.pageNumber === "number" ? { pageNumber: c.sourceAsset.pageNumber } : {}),
            },
          }
        : {}),
      usedInThisNote,
      isQuote: !!c.sourceAsset && splitMemoBodyAndSource(c.text).source !== null,
    });
    // 書き出すメモの出典素材も、素材として添える
    if (c.sourceAsset) extraAssets.add(c.sourceAsset.fileId);
  }
  if (memos.length > 0) extras.memos = memos;

  const assets: AssetExportEntry[] = [];
  for (const fileId of new Set([...referenced, ...extraAssets])) {
    const entry = media.get(fileId);
    if (entry) assets.push(toAssetEntry(entry));
  }
  if (assets.length > 0) extras.assets = assets;

  // ── メディア URL → fileId ──
  extras.resolveFileId = defaultResolveFileId;

  // ── 書き出す人 ──
  if (input.identity && (input.identity.name || input.identity.email)) {
    extras.humanAgent = {
      ...(input.identity.name ? { name: input.identity.name } : {}),
      ...(input.identity.email ? { email: input.identity.email } : {}),
    };
  }

  // ── 計画の線の名前（実績）──
  const planContext = input.planContext;
  if (planContext?.index) {
    const index = planContext.index;
    const plans = findPlanNotesOf(index, noteId);
    if (plans.length > 0) {
      const rowsByPlan = new Map<string, ReturnType<typeof collectOperationRows>>();
      const rowsOf = (planId: string) => {
        let rows = rowsByPlan.get(planId);
        if (!rows) {
          const planDoc = planContext.planDocs.get(planId);
          rows = planDoc ? collectOperationRows(planDoc, index) : [];
          rowsByPlan.set(planId, rows);
        }
        return rows;
      };
      extras.edgeLabelForLink = (link: BlockLink) => {
        if (!link.targetNoteId) return undefined;
        for (const plan of plans) {
          const rows = rowsOf(plan.noteId);
          const rowB = rows.find((r) => r.noteId === noteId);
          const rowA = rows.find((r) => r.noteId === link.targetNoteId);
          if (!rowA || !rowB) continue;
          const name = rowB.inputLabels?.[normalizeOperationName(rowA.name)];
          if (name) return name;
        }
        return undefined;
      };
    }
  }

  return extras;
}
