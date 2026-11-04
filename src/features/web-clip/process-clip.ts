// 届いたクリップ 1 件を、メモ・URL 素材・ノートへ振り分ける。
//
// 書き込みはすべて依存注入（note-app が既存のハンドラを渡す）。ここは順番と分岐だけを持つ:
//   1. URL 素材を探す（DOI → 正規化 URL）。無ければ「Web クリップ」フォルダに登録する
//   2. 範囲を選んでいればメモを作る（出典＝URL 素材・作成時刻＝クリップした時刻）
//   3. まとめ先のノートが無ければ作る（ブックマーク＋最初の引用）。あれば末尾に引用を足す
//      — 開いて編集中のノートは外から書くと自動保存に上書きされるので、エディタ経由で入れる

import type { GraphiumDocument } from "../../lib/document-types";
import type { MediaIndex, MediaIndexEntry } from "../asset-browser/media-index";
import type { CaptureEntry, MemoSourceAsset } from "../mobile-capture/capture-store";
import {
  appendClipQuote,
  buildClipMemoText,
  buildClipNoteDocument,
  clipTitle,
  findClipUrlEntry,
  type WebClip,
} from "./clip-note";

export type ProcessClipDeps = {
  /** いまの素材索引（登録直後の分も見えるよう、呼ぶたびに最新を返す） */
  getMediaIndex: () => Pick<MediaIndex, "media"> | null;
  /** URL 素材を登録する（handleAddUrlBookmark） */
  addUrlEntry: (entry: MediaIndexEntry) => void;
  /** URL 素材の一部を書き換える（まとめ先ノートの記録） */
  patchUrlEntry: (fileId: string, patch: Partial<MediaIndexEntry>) => Promise<void> | void;
  /** メモを作り、作ったメモを返す */
  createMemo: (args: { text: string; createdAt: string; sourceAsset: MemoSourceAsset; folder: string }) => Promise<CaptureEntry>;
  /** メモが使われたノートを記録する（メモの usedIn） */
  recordMemoUsage: (captureId: string, noteId: string, noteTitle: string) => void;
  /** ノートが今も使えるか（削除・ゴミ箱なら false） */
  noteExists: (noteId: string) => boolean;
  /** 新しいノートを作り、id を返す */
  createNote: (doc: GraphiumDocument) => Promise<string>;
  /** そのノートがいまエディタで開かれているか */
  isNoteOpen: (noteId: string) => boolean;
  /** 開いているノートの末尾へ、エディタ経由で引用を入れる */
  insertIntoOpenNote: (memo: CaptureEntry) => void;
  /** 閉じているノートを読む・保存する */
  loadNote: (noteId: string) => Promise<GraphiumDocument>;
  saveNote: (noteId: string, doc: GraphiumDocument) => Promise<void>;
  /** 新しい URL 素材の id・ドメイン・favicon */
  newUrlEntryId: () => string;
  domainOf: (url: string) => string;
  faviconOf: (domain: string, url: string) => string;
};

export type ProcessClipResult = {
  noteId: string;
  noteTitle: string;
  memoId?: string;
  /** ノートを新しく作ったか */
  createdNote: boolean;
};

/**
 * 1 回の見張りの中で作ったまとめ先（URL 素材の fileId → ノート id）。
 * 依存が返す索引は React の state 由来で、同じ回のうちは作ったばかりのノートが
 * まだ見えない。覚えておかないと、同じページの 2 件目でノートを二重に作る
 */
export type ClipRunMemory = Map<string, string>;

export async function processClip(
  clip: WebClip,
  folder: string,
  deps: ProcessClipDeps,
  run: ClipRunMemory = new Map(),
): Promise<ProcessClipResult> {
  const title = clipTitle(clip);
  const domain = deps.domainOf(clip.url);

  // 1. URL 素材
  let entry = findClipUrlEntry(deps.getMediaIndex(), clip);
  if (!entry) {
    entry = {
      fileId: deps.newUrlEntryId(),
      name: title,
      type: "url",
      mimeType: "text/x-uri",
      url: clip.url,
      thumbnailUrl: deps.faviconOf(domain, clip.url),
      uploadedAt: clip.clippedAt,
      usedIn: [],
      urlMeta: { domain },
      noteContexts: [folder],
      ...(clip.doi ? { webClip: { doi: clip.doi } } : {}),
    };
    deps.addUrlEntry(entry);
  }

  // 2. メモ
  const text = clip.text?.trim();
  const memo = text
    ? await deps.createMemo({
        text: buildClipMemoText(clip),
        createdAt: clip.clippedAt,
        sourceAsset: { fileId: entry.fileId, type: "url" },
        folder,
      })
    : undefined;

  // 3. ノート
  const createdThisRun = run.get(entry.fileId);
  const knownNoteId = createdThisRun ?? entry.webClip?.noteId;
  if (!knownNoteId || (!createdThisRun && !deps.noteExists(knownNoteId))) {
    // ノートのブックマークは素材の URL に揃える（usedIn は bookmark の url の完全一致で同期される）
    const doc = buildClipNoteDocument({
      clip: { url: entry.url, title },
      domain,
      folder,
      ...(memo ? { memo } : {}),
    });
    const noteId = await deps.createNote(doc);
    run.set(entry.fileId, noteId);
    await deps.patchUrlEntry(entry.fileId, {
      webClip: { ...entry.webClip, noteId, ...(clip.doi ? { doi: clip.doi } : {}) },
    });
    if (memo) deps.recordMemoUsage(memo.id, noteId, doc.title);
    return { noteId, noteTitle: doc.title, ...(memo ? { memoId: memo.id } : {}), createdNote: true };
  }

  if (!memo) {
    // 範囲を選ばずに同じページをもう一度クリップした — ノートはもうあるので何もしない
    return { noteId: knownNoteId, noteTitle: title, createdNote: false };
  }

  if (deps.isNoteOpen(knownNoteId)) {
    // usedIn の記録は挿入が済んだとき（note-app の onMemoInserted）に行う
    deps.insertIntoOpenNote(memo);
    return { noteId: knownNoteId, noteTitle: title, memoId: memo.id, createdNote: false };
  }

  const doc = await deps.loadNote(knownNoteId);
  const updated = appendClipQuote(doc, memo);
  if (updated) {
    await deps.saveNote(knownNoteId, updated);
    deps.recordMemoUsage(memo.id, knownNoteId, updated.title);
  }
  return { noteId: knownNoteId, noteTitle: doc.title, memoId: memo.id, createdNote: false };
}
