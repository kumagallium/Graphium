// ノートの索引・素材の索引・メモの一覧を、ダッシュボードの 1 件の記録（RecordItem）に写す。
// 読むだけの純粋な関数で、保存形式・索引のスキーマ・StorageProvider には触れない。
// ほかの機能からは型だけを借りる（実行時の依存を作らない）。
//
// 出どころ（どこで）と残した人（誰が）に専用の欄は無いので、ここで既存の項目から導く。
// 導けないものは作らない:
//   - 会議の録音: 素材の usedIn は「どのノートのどのブロックで使われたか」までで、そのブロックが
//     文字起こしブロックか、ただの音声ブロックかを持たない。索引だけでは見分けられないので札にしない
//   - スマホで書いた文字のメモ: メモは書いた端末を持たない
//   - 共有ライブラリの記録: 別の置き場（SharedEntry）なので、ここでは扱わない
import type { MediaIndexEntry } from "../asset-browser/media-index";
import type { CaptureEntry } from "../mobile-capture/capture-store";
import type { NoteIndexEntry } from "../navigation/index-file";
import { timeOf } from "./model";
import type { RecordItem, RecordMediaType, RecordOrigin, RecordWho } from "./types";

export type RecordSources = {
  notes: readonly NoteIndexEntry[];
  media: readonly MediaIndexEntry[];
  captures: readonly CaptureEntry[];
  /**
   * ごみ箱・アーカイブにあるノート。一覧には出さない。録音の素材の出どころを決めるのにだけ使う
   * （録音を置いたノートを捨てても、その録音は録音のまま）。
   * アプリは notes からごみ箱・アーカイブを除いて渡すので、別に受け取る
   */
  hiddenNotes?: readonly NoteIndexEntry[];
};

/** 題の下の 1 行に並べる見出しの数 */
const DETAIL_HEADINGS = 3;

/** Web クリップのまとめ先になっているノートの ID（URL 素材の webClip.noteId から集める） */
export function collectWebClipNoteIds(media: readonly MediaIndexEntry[]): Set<string> {
  const ids = new Set<string>();
  for (const m of media) {
    if (m.webClip?.noteId) ids.add(m.webClip.noteId);
  }
  return ids;
}

/**
 * ノートと AI のページの出どころ。上から順に、初めに当たったもの。
 * - AI のページ（source が "ai"）→ ナレッジ化
 * - Web クリップのまとめ先 → Web クリップ
 * - 録音済みの文字起こしブロックを持つ（hasRecording）→ 録音から
 * - モデル名を持つ（AI が書いた）→ AI から
 * - 投入口で取り込んだ（importSourceHash）→ 取り込んだファイル
 * - テンプレートから作った（templateFrom）→ テンプレートから
 * - どれでもない → 手で書いた
 */
export function deriveNoteOrigin(entry: NoteIndexEntry, webClipNoteIds: ReadonlySet<string>): RecordOrigin {
  if (entry.source === "ai") return "knowledge";
  if (webClipNoteIds.has(entry.noteId)) return "webClip";
  if (entry.hasRecording) return "recording";
  if (entry.model) return "aiChat";
  if (entry.importSourceHash) return "file";
  if (entry.templateFrom) return "template";
  return "written";
}

/** ノートと AI のページを残した人。モデル名があれば AI が関わっている */
export function deriveNoteWho(entry: NoteIndexEntry): RecordWho {
  if (entry.source === "ai") return { type: "ai", ...(entry.model ? { model: entry.model } : {}) };
  if (entry.model) return { type: "selfWithAi", model: entry.model };
  return { type: "self" };
}

/**
 * 素材の出どころ。
 * - 受信箱から取り込んだ（capture）→ スマホから
 * - Web クリップ、または URL の素材 → Web クリップ
 * - 録音・文字起こしを持つノートが使っている音声・動画 → 録音から
 * - それ以外 → 取り込んだファイル
 */
export function deriveMediaOrigin(entry: MediaIndexEntry, recordingNoteIds?: ReadonlySet<string>): RecordOrigin {
  if (entry.capture) return "phone";
  if (entry.webClip || entry.type === "url") return "webClip";
  if (isRecordingMedia(entry, recordingNoteIds)) return "recording";
  return "file";
}

/** 録音・文字起こしを持つノート（hasRecording）の ID */
export function collectRecordingNoteIds(notes: readonly NoteIndexEntry[]): Set<string> {
  const ids = new Set<string>();
  for (const n of notes) {
    if (n.hasRecording) ids.add(n.noteId);
  }
  return ids;
}

/**
 * 録音の素材か。素材の索引には「アプリで録った録音」の印が無いので、
 * 「音声・動画の素材で、録音・文字起こしを持つノートが使っている」ことから導く。
 * どのノートにも置いていない録音は見分けられず、取り込んだファイルのままになる。
 */
export function isRecordingMedia(entry: MediaIndexEntry, recordingNoteIds?: ReadonlySet<string>): boolean {
  if (!recordingNoteIds || recordingNoteIds.size === 0) return false;
  if (entry.type !== "audio" && entry.type !== "video") return false;
  return (entry.usedIn ?? []).some((u) => recordingNoteIds.has(u.noteId));
}

/**
 * 録音の文字起こしで当たった素材から、その録音を持つノートにも当たりを広げる。
 * ノートの本文には文字起こしが入らない（素材のそばに保存される）ので、こうしないと
 * 「会議で話した言葉」でノートが見つからない。ノート自身が本文で当たっていれば、そちらを残す。
 * hits のキーは記録の id（"note:<id>" / "media:<fileId>"）。
 */
export function spreadRecordingHits<T>(
  hits: Map<string, T>,
  media: readonly MediaIndexEntry[],
  recordingNoteIds: ReadonlySet<string>,
): Map<string, T> {
  if (recordingNoteIds.size === 0) return hits;
  for (const m of media) {
    const hit = hits.get(`media:${m.fileId}`);
    if (hit === undefined || !isRecordingMedia(m, recordingNoteIds)) continue;
    for (const u of m.usedIn ?? []) {
      const key = `note:${u.noteId}`;
      if (recordingNoteIds.has(u.noteId) && !hits.has(key)) hits.set(key, hit);
    }
  }
  return hits;
}

/** メモの出どころ。素材から引用したメモだけ区別できる */
export function deriveMemoOrigin(entry: CaptureEntry): RecordOrigin {
  return entry.sourceAsset ? "quote" : "memo";
}

/** 入っているフォルダ。無ければ項目ごと持たない */
function foldersOf(contexts: readonly string[] | undefined): { folders?: readonly string[] } {
  return contexts && contexts.length > 0 ? { folders: contexts } : {};
}

/** 使われているノートの数（同じノートの複数ブロックは 1 つに数える） */
function countNotes(usedIn: readonly { noteId: string }[] | undefined): number {
  return new Set((usedIn ?? []).map((u) => u.noteId)).size;
}

export function noteToRecord(entry: NoteIndexEntry, webClipNoteIds: ReadonlySet<string>): RecordItem {
  const isWiki = entry.source === "ai";
  const headings = entry.headings.map((h) => h.text.trim()).filter(Boolean).slice(0, DETAIL_HEADINGS);
  const sources = entry.derivedFromNotes?.length ?? 0;
  return {
    id: `note:${entry.noteId}`,
    kind: isWiki ? "wiki" : "note",
    at: entry.createdAt || entry.modifiedAt,
    origin: deriveNoteOrigin(entry, webClipNoteIds),
    who: deriveNoteWho(entry),
    title: entry.title,
    ...(headings.length > 0 ? { detail: headings.join(" · ") } : {}),
    ...(isWiki && sources > 0 ? { trace: { type: "sources" as const, count: sources } } : {}),
    ...foldersOf(entry.noteContexts),
  };
}

export function mediaToRecord(entry: MediaIndexEntry, recordingNoteIds?: ReadonlySet<string>): RecordItem {
  const used = countNotes(entry.usedIn);
  const detail = entry.urlMeta?.excerpt?.trim() || entry.urlMeta?.description?.trim();
  return {
    id: `media:${entry.fileId}`,
    kind: "media",
    at: entry.uploadedAt,
    origin: deriveMediaOrigin(entry, recordingNoteIds),
    // 素材に残した人の欄は無い。手元の保存先に入っているものなので「自分」と導く
    who: { type: "self" },
    title: entry.name,
    mediaType: entry.type as RecordMediaType,
    ...(detail ? { detail } : {}),
    ...(entry.urlMeta?.domain ? { domain: entry.urlMeta.domain } : {}),
    ...(typeof entry.pageCount === "number" ? { pageCount: entry.pageCount } : {}),
    ...(used > 0 ? { trace: { type: "usedIn" as const, count: used } } : {}),
    ...foldersOf(entry.noteContexts),
  };
}

export function memoToRecord(entry: CaptureEntry): RecordItem {
  const used = countNotes(entry.usedIn);
  return {
    id: `memo:${entry.id}`,
    kind: "memo",
    at: entry.createdAt,
    origin: deriveMemoOrigin(entry),
    // メモの createdBy は型にあるだけで、書き込む箇所が無い。素材と同じく「自分」と導く
    who: { type: "self" },
    text: entry.text,
    ...(used > 0 ? { trace: { type: "usedIn" as const, count: used } } : {}),
    ...foldersOf(entry.noteContexts),
  };
}

/**
 * 3 つの置き場の記録を 1 本にして、新しい順に並べる。
 * 外すもの: ゴミ箱・アーカイブに入っているもの、スキル（プロンプトのひな形）、
 * メモを素材として見せるための一時エントリ（type が "memo"）。
 */
export function buildRecords(sources: RecordSources): RecordItem[] {
  const webClipNoteIds = collectWebClipNoteIds(sources.media);
  const recordingNoteIds = collectRecordingNoteIds([...sources.notes, ...(sources.hiddenNotes ?? [])]);
  const items: RecordItem[] = [];
  for (const n of sources.notes) {
    if (n.deletedAt || n.archivedAt || n.source === "skill") continue;
    items.push(noteToRecord(n, webClipNoteIds));
  }
  for (const m of sources.media) {
    if (m.archivedAt || m.type === "memo") continue;
    items.push(mediaToRecord(m, recordingNoteIds));
  }
  for (const c of sources.captures) {
    if (c.deletedAt || c.archivedAt) continue;
    items.push(memoToRecord(c));
  }
  return items.sort((a, b) => timeOf(b.at) - timeOf(a.at));
}
