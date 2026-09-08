// 共有エントリ id → 手元のノート id の控え（§25b B-6）。
//
// 何のためにあるか:
//   共有ライブラリの「提案」を開いた人が、その場から取り込みを始められるようにする。
//   提案の宛先は **共有エントリの id** なので、画面からは「自分のどのノートの話か」が
//   辿れない。取り込みの実処理はノートの編集画面にしか置けない（エディタが無いと
//   ⌘Z で戻せず、ラベル / リンクのストアにも反映できない）ので、
//   「共有エントリ id → 手元のノート id」を引ける口がどうしても要る。
//
// 守っていること:
//   - 手元だけ。共有フォルダには一切書かない（appData のみ）—— fork-base と同じ作法
//   - 控えはノート 1 件につき 1 ファイル。読み書きが 1 件で完結するので、
//     複数の共有が同時に走っても互いの控えを踏まない
//   - 読めない・書けないは失敗にしない。控えが無ければ手元のノートを走査して探す
//   - 走査は「押したときだけ」。描画のたびに全ノートを読むことはしない
//
// 設計詳細: docs/internal/team-shared-storage-design.md §25b

import { readAppDataFile, writeAppDataFile } from "../../lib/storage/app-data-file";
import type { GraphiumDocument } from "../../lib/document-types";
import type { StorageProvider } from "../../lib/storage/types";

/**
 * appData のキー。共有エントリ 1 件につき 1 ファイル。
 *
 * 区切りに `:` を使わないのは Windows のファイル名に `:` が使えないため
 * （Tauri 側は key をそのままファイル名にする）。fork-base と同じ畳み方。
 */
function appDataKey(sharedId: string): string {
  return `shared-note-link-${sanitizeId(sharedId)}`;
}

function driveFileName(sharedId: string): string {
  return `.graphium-shared-note-link-${sanitizeId(sharedId)}.json`;
}

function sanitizeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "_");
}

/** 共有した時点で控えた「この共有エントリは手元のこのノート」 */
export type SharedNoteLink = {
  /** 共有エントリ id（SharedEntry.id） */
  sharedId: string;
  /** 手元のノート id */
  noteId: string;
  /** 控えを取った時刻（ISO-8601） */
  savedAt: string;
};

function isSharedNoteLink(value: unknown): value is SharedNoteLink {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<SharedNoteLink>;
  return (
    typeof v.sharedId === "string" &&
    v.sharedId.length > 0 &&
    typeof v.noteId === "string" &&
    v.noteId.length > 0
  );
}

/**
 * 共有・再共有した時点で対応を控える。
 * 書けなくても呼び出し側を止めない（共有そのものは成立している）。
 */
export async function saveSharedNoteLink(
  sharedId: string,
  noteId: string,
  provider?: StorageProvider,
): Promise<void> {
  if (!sharedId || !noteId) return;
  const value: SharedNoteLink = { sharedId, noteId, savedAt: new Date().toISOString() };
  try {
    await writeAppDataFile(appDataKey(sharedId), driveFileName(sharedId), value, provider);
  } catch {
    // 控えが無ければ走査で探すだけ。共有を失敗させない
  }
}

/** 控えを読む。無い / 壊れているときは null（走査に落ちる）。 */
export async function loadSharedNoteLink(
  sharedId: string,
  provider?: StorageProvider,
): Promise<SharedNoteLink | null> {
  if (!sharedId) return null;
  try {
    const stored = await readAppDataFile<unknown>(
      appDataKey(sharedId),
      driveFileName(sharedId),
      provider,
    );
    return isSharedNoteLink(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** ノート 1 件を読む口（DI）。読めなければ null を返すこと（例外は投げない想定） */
export type LoadNoteDoc = (noteId: string) => Promise<GraphiumDocument | null>;

/**
 * 手元のノートを順に読んで、この共有エントリを指しているものを探す（純ロジック）。
 *
 * 控えが無い場合（この仕組みより前に共有したノート）の受け皿。見つかった時点で
 * 打ち切るので、最近のノートから順に渡すと当たりが早い。
 * 読めないノートは黙って飛ばす（1 件の読み落としで探索ごと止めない）。
 */
export async function findNoteBySharedId(
  sharedId: string,
  noteIds: readonly string[],
  loadNote: LoadNoteDoc,
): Promise<string | null> {
  if (!sharedId) return null;
  for (const noteId of noteIds) {
    let doc: GraphiumDocument | null = null;
    try {
      doc = await loadNote(noteId);
    } catch {
      continue;
    }
    if (doc?.sharedRef?.id === sharedId) return noteId;
  }
  return null;
}

export type ResolveSharedNoteDeps = {
  /** 走査の対象。最近さわった順で渡すと当たりが早い */
  noteIds: readonly string[];
  loadNote: LoadNoteDoc;
  /**
   * 控えのノートがまだ手元にあるか（消した・別端末の控え を弾く）。
   * 未指定なら控えをそのまま信じる。
   */
  hasNote?: (noteId: string) => boolean;
  /** DI: appData の読み書き先（既定は現在のプロバイダ） */
  provider?: StorageProvider;
};

/**
 * 共有エントリ id から手元のノート id を引く（2 段構え）。
 *
 *   1. 共有した時点の控え（appData）を読む —— 当たれば 1 件読むだけで済む
 *   2. 無ければ手元のノートを走査して探し、見つかったら控えを書く
 *      （次からは 1 に当たる）
 *
 * どちらでも見つからなければ null。呼び出し側は「この端末にはこのノートが無い」
 * と案内する（別の端末で共有したノート・共有だけ受け取った他人のノート）。
 */
export async function resolveSharedNoteId(
  sharedId: string,
  deps: ResolveSharedNoteDeps,
): Promise<string | null> {
  if (!sharedId) return null;
  const link = await loadSharedNoteLink(sharedId, deps.provider);
  if (link && (!deps.hasNote || deps.hasNote(link.noteId))) return link.noteId;

  const found = await findNoteBySharedId(sharedId, deps.noteIds, deps.loadNote);
  if (found) await saveSharedNoteLink(sharedId, found, deps.provider);
  return found;
}
