// 共有ノートの投影キャッシュ（.graphium-shared-projection.json）
//
// 何のためにあるか:
//   Library に「ラベル」「プロセス」のタブを出すには、共有ノートの本文から
//   ラベル・手順を取り出した結果が要る。一覧は本文を読まずに描くので、
//   読めたときに拾った結果をここへ控える（個人側の note-index / process-index と同じ考え方）。
//
// 守っていること:
//   - 手元だけ。共有フォルダには一切書かない（appdata / デスクトップのみ）
//   - 新しい読み取りを足さない。語彙索引レーン（shared-library-sync）が本文を読む
//     ついでに投影する。hash が一致していればスキップするので、同じ版は 1 回しか投影しない
//   - P-1: プロセスは buildProcessEntry の戻り値をそのまま持つ。一覧のために
//     別経路で構造を組み立てない（二つの真実を作らない）
//   - ラベルは buildIndexEntry の結果から取り出す。ノート一覧の索引と同じ抽出にする
//   - 再構築可能なキャッシュなので、版が合わなければ黙って捨てる（壊れても実害が無い）
//
// 設計詳細: docs/internal/team-shared-storage-design.md §19

import { useSyncExternalStore } from "react";
import type { GraphiumDocument } from "../../lib/document-types";
import type { SharedEntry } from "../../lib/storage/shared";
import {
  buildIndexEntry,
  INDEX_SCHEMA_VERSION,
  type GraphiumIndex,
  type NoteIndexEntry,
} from "../navigation/index-file";
import { collectSharedCitationIds } from "../../blocks/shared-citation/collect";
import {
  buildProcessEntry,
  PROCESS_INDEX_VERSION,
  type ProcessIndex,
  type ProcessIndexEntry,
} from "../network-graph/process-index";
import { readAppDataFile, writeAppDataFile } from "../../lib/storage/app-data-file";
import { isTauri } from "../../lib/platform";

/**
 * 投影ファイルの形の版。形を変えたら上げる → 読み込み時に捨てて作り直す。
 * v2: 逆引き用の citedSharedIds / forkedFromSharedId / templateFromSharedId を追加。
 */
export const SHARED_PROJECTION_VERSION = 2;

const APP_DATA_KEY = "shared-projection";
const DRIVE_FILE_NAME = ".graphium-shared-projection.json";

/** 書き込みのデバウンス。共有の読み込みは連続して起きるので 1 回にまとめる */
const SAVE_DEBOUNCE_MS = 2000;

/**
 * 購読者への通知をまとめる間隔。
 *
 * 投影は共有ノート 1 件ずつ進む（reconcile が stale なソースを順に読む）ので、
 * そのたびに通知すると Library のラベル / プロセスタブが 1 件ごとに作り直される。
 * 数百件の初回バックフィルでは、見えている一覧・グラフがちらつき続ける。
 * 中身（getSharedProjection）は即座に最新なので、通知だけ束ねて再レンダーを減らす。
 */
const NOTIFY_COALESCE_MS = 200;

export type SharedProjectionEntry = {
  /** 投影したときの entry.hash。一致すれば投影し直さない */
  hash: string;
  title: string;
  /** entry.updated_at */
  updatedAt: string;
  /** entry.created_at */
  createdAt: string;
  /** entry.author.name */
  author: string;
  headings: NoteIndexEntry["headings"];
  steps?: NoteIndexEntry["steps"];
  labels: NoteIndexEntry["labels"];
  inlineLabels?: NoteIndexEntry["inlineLabels"];
  /** 手順を持たないノートは null（プロセス一覧に出さない） */
  process: ProcessIndexEntry | null;
  /**
   * このノートが引用している共有エントリ id（sharedCitation ブロック）。
   * 「このエントリを引用している共有ノート」の逆引きに使う。
   */
  citedSharedIds: string[];
  /** fork 元の共有エントリ id（doc.forkedFrom.sharedId） */
  forkedFromSharedId?: string;
  /** 元にした共有テンプレートの id（doc.templateFrom.sharedId） */
  templateFromSharedId?: string;
};

export type SharedProjection = {
  version: number;
  /**
   * 抽出ロジックの版。note-index / process-index のどちらかが変われば
   * 抽出結果の形が変わるので、全部捨てて投影し直す。
   */
  logic: { index: number; process: number };
  updatedAt: string;
  /** sharedId → 投影 */
  entries: Record<string, SharedProjectionEntry>;
};

export function createEmptySharedProjection(): SharedProjection {
  return {
    version: SHARED_PROJECTION_VERSION,
    logic: { index: INDEX_SCHEMA_VERSION, process: PROCESS_INDEX_VERSION },
    updatedAt: new Date().toISOString(),
    entries: {},
  };
}

// ── 投影（純関数） ──

function extraTitle(entry: SharedEntry): string {
  const title = (entry.extra as Record<string, unknown> | undefined)?.title;
  return typeof title === "string" ? title.trim() : "";
}

/**
 * 共有ノート 1 件を投影する。type === "note" のエントリにだけ使う。
 *
 * プロセスは buildProcessEntry の戻り値をそのまま持つ（P-1）。ただし
 * crossNoteLinks だけは落とす —— 参照先は共有元の**ローカルノート id** なので、
 * 受け取った側で解決できず、解決できないまま持つと嘘の系譜になる。
 */
export function projectSharedNote(
  entry: SharedEntry,
  doc: GraphiumDocument,
): SharedProjectionEntry {
  const indexEntry = buildIndexEntry(entry.id, doc);
  // 引用・派生・テンプレートは共有 id で書かれている ＝ 受け取った側でも解決できる
  //（crossNoteLinks / outgoingLinks を落とすのと逆の理由でこちらは持ち帰る）
  const cited = new Set<string>();
  for (const page of doc.pages ?? []) {
    for (const id of collectSharedCitationIds((page as { blocks?: unknown }).blocks)) cited.add(id);
  }
  // 鮮度の基準はノートの modifiedTime に相当するもの ＝ 共有エントリの更新時刻
  const process = buildProcessEntry(entry.id, doc, { modifiedTime: entry.updated_at });
  return {
    hash: entry.hash,
    title: extraTitle(entry) || doc.title || "",
    updatedAt: entry.updated_at,
    createdAt: entry.created_at,
    author: entry.author?.name ?? "",
    headings: indexEntry.headings,
    ...(indexEntry.steps && indexEntry.steps.length > 0 ? { steps: indexEntry.steps } : {}),
    labels: indexEntry.labels,
    ...(indexEntry.inlineLabels && indexEntry.inlineLabels.length > 0
      ? { inlineLabels: indexEntry.inlineLabels }
      : {}),
    process: process ? { ...process, crossNoteLinks: [] } : null,
    citedSharedIds: [...cited],
    ...(doc.forkedFrom?.sharedId ? { forkedFromSharedId: doc.forkedFrom.sharedId } : {}),
    ...(doc.templateFrom?.sharedId ? { templateFromSharedId: doc.templateFrom.sharedId } : {}),
  };
}

/** 本文（JSON テキスト）を GraphiumDocument として読む。壊れていれば null */
function parseDocument(body: Uint8Array): GraphiumDocument | null {
  try {
    const doc = JSON.parse(new TextDecoder().decode(body)) as GraphiumDocument;
    return doc && typeof doc === "object" && Array.isArray(doc.pages) ? doc : null;
  } catch {
    return null;
  }
}

/**
 * 保存されていた投影を受け入れられるか判定する。
 * 版が合わなければ null（＝捨てて作り直す。再構築可能なキャッシュなので実害は無い）。
 */
export function parseStoredProjection(raw: unknown): SharedProjection | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<SharedProjection>;
  if (candidate.version !== SHARED_PROJECTION_VERSION) return null;
  const logic = candidate.logic;
  if (!logic || typeof logic !== "object") return null;
  if (logic.index !== INDEX_SCHEMA_VERSION || logic.process !== PROCESS_INDEX_VERSION) return null;
  if (!candidate.entries || typeof candidate.entries !== "object") return null;
  const entries: Record<string, SharedProjectionEntry> = {};
  for (const [id, value] of Object.entries(candidate.entries)) {
    // hash が無いものは差分投影の判定に使えないので採らない
    if (value && typeof value === "object" && typeof (value as SharedProjectionEntry).hash === "string") {
      const projected = value as SharedProjectionEntry;
      // 逆引きの配列は無くても読めるようにする（壊れた控えで一覧を落とさない）
      entries[id] = {
        ...projected,
        citedSharedIds: Array.isArray(projected.citedSharedIds) ? projected.citedSharedIds : [],
      };
    }
  }
  return {
    version: SHARED_PROJECTION_VERSION,
    logic: { index: INDEX_SCHEMA_VERSION, process: PROCESS_INDEX_VERSION },
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date().toISOString(),
    entries,
  };
}

// ── ストア（React から購読する） ──

let current: SharedProjection = createEmptySharedProjection();
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
/** 書き込みの直列化キュー（process-index の processIndexSaveChain と同じ作法） */
let saveChain: Promise<void> = Promise.resolve();
let loadPromise: Promise<void> | null = null;

function notifyAll(): void {
  for (const listener of listeners) listener();
}

/** すぐ通知する。予約済みの束ねがあれば畳んでから出す（二重通知を避ける） */
function emit(): void {
  if (notifyTimer) {
    clearTimeout(notifyTimer);
    notifyTimer = null;
  }
  notifyAll();
}

/** 連続した投影を 1 回の通知にまとめる。予約済みなら何もしない（間隔を延ばさない） */
function scheduleEmit(): void {
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    notifyAll();
  }, NOTIFY_COALESCE_MS);
}

function commit(next: SharedProjection): void {
  current = next;
  scheduleEmit();
  scheduleSave();
}

async function persist(): Promise<void> {
  try {
    await writeAppDataFile(APP_DATA_KEY, DRIVE_FILE_NAME, current);
  } catch {
    // 書けなくても投影は次回作り直せる。起動を止めない
  }
}

function scheduleSave(): void {
  // 共有はデスクトップのみ。ブラウザで空ファイルを作らない
  if (!isTauri()) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    // 前の書き込みが終わってから次を書く。デバウンスのタイマーだけでは、
    // 書き込みがデバウンス間隔より長引いたときに 2 つの persist が並走し、
    // 解決順が入れ替わると古い投影が新しい投影を上書きしうる
    // （process-index の processIndexSaveChain と同じ理由）。
    saveChain = saveChain.then(persist, persist);
  }, SAVE_DEBOUNCE_MS);
}

/** テスト用。予約済みの書き込みが片付くまで待つ */
export function __flushSharedProjectionSaveForTest(): Promise<void> {
  return saveChain;
}

/** 起動時に 1 回だけ読む。版が合わなければ捨てて空から始める */
export function loadSharedProjection(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    if (!isTauri()) return;
    let stored: SharedProjection | null = null;
    try {
      stored = parseStoredProjection(await readAppDataFile<unknown>(APP_DATA_KEY, DRIVE_FILE_NAME));
    } catch {
      stored = null;
    }
    if (!stored) return;
    // 読んでいる間に投影された分（新しく読めた本文）を古い控えで上書きしない
    current = {
      ...stored,
      entries: { ...stored.entries, ...current.entries },
    };
    emit();
  })();
  return loadPromise;
}

export function getSharedProjection(): SharedProjection {
  return current;
}

export function subscribeSharedProjection(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React 用。スナップショットは変化時だけ差し替わるので参照比較で足りる */
export function useSharedProjection(): SharedProjection {
  return useSyncExternalStore(subscribeSharedProjection, getSharedProjection, getSharedProjection);
}

/**
 * 本文を読んだついでに投影する。共有エントリを読む経路（語彙索引レーン）から呼ぶ。
 *
 * - type !== "note" は対象外（ラベル・プロセスは人が書いたノートのもの）
 * - hash が合わなかった本文（verified === false）は中身を信用しない
 * - 同じ hash が既にあれば何もしない ＝ 差分投影
 */
export function recordSharedProjectionFromBody(
  entry: SharedEntry,
  body: Uint8Array,
  verified: boolean,
  /**
   * 既にパース済みの本文。同じ body は語彙索引にも渡るので、呼び出し側が
   * 1 回だけパースして両方に配れるようにする（大きい本文の二重パースを避ける）。
   * undefined = 未パース（ここで読む）／null = パースしたが壊れていた。
   */
  parsed?: GraphiumDocument | null,
): void {
  if (entry.type !== "note" || !verified) return;
  if (current.entries[entry.id]?.hash === entry.hash) return;
  const doc = parsed === undefined ? parseDocument(body) : parsed;
  if (!doc) return;
  commit({
    ...current,
    updatedAt: new Date().toISOString(),
    entries: { ...current.entries, [entry.id]: projectSharedNote(entry, doc) },
  });
}

/**
 * 共有から消えた投影を落とす。共有ストアの一覧（＝いま共有フォルダにある id）を渡す。
 * 索引の removeMissing と同じ役割で、消えたノートがタブに残り続けるのを防ぐ。
 */
export function pruneSharedProjection(liveIds: Iterable<string>): void {
  const keep = new Set(liveIds);
  const ids = Object.keys(current.entries);
  const removed = ids.filter((id) => !keep.has(id));
  if (removed.length === 0) return;
  const entries: Record<string, SharedProjectionEntry> = {};
  for (const id of ids) if (keep.has(id)) entries[id] = current.entries[id];
  commit({ ...current, updatedAt: new Date().toISOString(), entries });
}

// ── 個人側のビューへ渡す形に組み替える ──

/**
 * LabelGalleryView 用の擬似 GraphiumIndex。
 *
 * noteId は sharedId。共有ノートのリンク先は共有元のローカルノート id なので
 * outgoingLinks は空にする（解決できないリンクを持たせない）。
 * source は "human" 固定 —— 共有ノート（type === "note"）は人が書いたもの。
 */
export function buildSharedPseudoIndex(
  projection: SharedProjection,
  entries: SharedEntry[],
): GraphiumIndex {
  const notes: NoteIndexEntry[] = [];
  for (const entry of entries) {
    if (entry.type !== "note") continue;
    const projected = projection.entries[entry.id];
    if (!projected) continue;
    notes.push({
      noteId: entry.id,
      title: projected.title,
      modifiedAt: projected.updatedAt,
      createdAt: projected.createdAt,
      headings: projected.headings,
      ...(projected.steps ? { steps: projected.steps } : {}),
      labels: projected.labels,
      outgoingLinks: [],
      source: "human",
      author: projected.author || entry.author?.name || undefined,
      ...(projected.inlineLabels ? { inlineLabels: projected.inlineLabels } : {}),
    });
  }
  return {
    version: INDEX_SCHEMA_VERSION,
    updatedAt: projection.updatedAt,
    notes,
  };
}

/** ProcessGalleryView 用の ProcessIndex。手順を持つ投影だけを並べる */
export function buildSharedProcessIndex(projection: SharedProjection): ProcessIndex {
  const processes: ProcessIndexEntry[] = [];
  for (const projected of Object.values(projection.entries)) {
    if (projected.process) processes.push(projected.process);
  }
  return {
    version: PROCESS_INDEX_VERSION,
    updatedAt: projection.updatedAt,
    processes,
  };
}

/** ラベル（インライン含む）を 1 つ以上持つ投影の数。タブの件数バッジ用 */
export function countProjectedLabelNotes(
  projection: SharedProjection,
  ids: Iterable<string>,
): number {
  let count = 0;
  for (const id of ids) {
    const projected = projection.entries[id];
    if (!projected) continue;
    if (projected.labels.length > 0 || (projected.inlineLabels?.length ?? 0) > 0) count++;
  }
  return count;
}

/** 手順を持つ投影の数。タブの件数バッジ用 */
export function countProjectedProcessNotes(
  projection: SharedProjection,
  ids: Iterable<string>,
): number {
  let count = 0;
  for (const id of ids) {
    if (projection.entries[id]?.process) count++;
  }
  return count;
}

/** 逆引きの並び（引用・派生・テンプレート） */
export type SharedReverseLinks = {
  /** この id を引用している共有ノートの id */
  cites: string[];
  /** この id を fork して作られた共有ノートの id */
  forks: string[];
  /** この id（テンプレート）から作られた共有ノートの id */
  templates: string[];
};

/**
 * 投影から逆引き表を作る（純関数）。
 *
 * 元になるのは「本文を読めた共有ノート」の投影だけなので、読み込み前は
 * 少なく見える —— これは仕様（読めていないものについて嘘を言わない）。
 */
export function buildReverseLinks(
  projection: SharedProjection,
): Map<string, SharedReverseLinks> {
  const out = new Map<string, SharedReverseLinks>();
  const bucket = (targetId: string): SharedReverseLinks => {
    let v = out.get(targetId);
    if (!v) {
      v = { cites: [], forks: [], templates: [] };
      out.set(targetId, v);
    }
    return v;
  };
  for (const [sourceId, projected] of Object.entries(projection.entries)) {
    for (const targetId of projected.citedSharedIds ?? []) {
      // 自分自身への引用は逆引きに出さない（自己ループを作らない）
      if (targetId === sourceId) continue;
      const list = bucket(targetId).cites;
      if (!list.includes(sourceId)) list.push(sourceId);
    }
    const forkedFrom = projected.forkedFromSharedId;
    if (forkedFrom && forkedFrom !== sourceId) {
      const list = bucket(forkedFrom).forks;
      if (!list.includes(sourceId)) list.push(sourceId);
    }
    const templateFrom = projected.templateFromSharedId;
    if (templateFrom && templateFrom !== sourceId) {
      const list = bucket(templateFrom).templates;
      if (!list.includes(sourceId)) list.push(sourceId);
    }
  }
  return out;
}

/** テスト用。モジュールスコープのストアを初期状態に戻す */
export function __resetSharedProjectionForTest(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  if (notifyTimer) clearTimeout(notifyTimer);
  notifyTimer = null;
  loadPromise = null;
  current = createEmptySharedProjection();
  emit();
}
