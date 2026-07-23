// 付箋キャプチャの軽量インデックス（.graphium-captures.json）
// メディアインデックスと同じパターンで、Google Drive / Local / Filesystem に対応

import { getActiveProvider } from "../../lib/storage/registry";
import type { MediaType } from "../asset-browser/media-index";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const INDEX_FILE_NAME = ".graphium-captures.json";

// ── 型定義 ──

/** メモが挿入されたノートの情報 */
export type MemoUsage = {
  noteId: string;
  noteTitle: string;
  insertedAt: string;
};

/**
 * メモがナレッジ化されて生成されたノートの情報
 *
 * メモ一覧の「ナレッジ化」操作で新規ノートに変換された際、その生成先ノートを
 * 元メモに逆リンクとして記録する。これにより ①どのメモがナレッジ化済みか
 * （一覧のバッジ）②ナレッジ化してどのノートになったか（詳細から辿れる）を可能にする。
 * usedIn（本文への挿入）とは意味が異なるため別フィールドにする。
 */
export type MemoKnowledged = {
  noteId: string;
  noteTitle: string;
  knowledgedAt: string;
};

/** 編集履歴エントリ */
export type MemoEditRecord = {
  /** 編集日時 */
  editedAt: string;
  /** 編集前のテキスト */
  previousText: string;
};

/**
 * メモの出典素材（PR3-a で追加）
 *
 * Quote→Memo 経由で作られたメモが「どの素材のどの位置から派生したか」を
 * 構造化して保持するためのフィールド。
 * - fileId: 素材の MediaIndexEntry.fileId
 * - type: PDF / image / url 等の媒体種別
 * - pageNumber: PDF のページ番号（あれば）
 *
 * optional なので未設定の旧メモも従来通り動く。後方互換のためフィルタは
 * sourceAsset 一致 OR テキスト一致 の OR で両対応する。
 */
export type MemoSourceAsset = {
  fileId: string;
  type: MediaType;
  pageNumber?: number;
};

/**
 * メモの出典ノート
 *
 * ノート編集画面の右パネル「Memos」タブから作成されたメモが
 * 「どのノートを開いていた時に書かれたか」を保持する。
 * - fileId: ノートの fileId（GraphiumDocument.fileId 相当）
 * - title: 作成時点のノートタイトル（表示用スナップショット）
 *
 * `sourceAsset` と排他ではなく、両方のフィルタ経路を許す。素材経由 / ノート経由
 * のどちらでも CaptureIndex に流れ込み、メモ一覧では横断的に見える。
 *
 * ブロック紐付け（optional）:
 * - blockId: ブロックメニュー「メモ」から作成された場合の紐付け先ブロック。
 *   ノート単位（fileId のみ）より一段強いアンカー。ブロックが後から削除された
 *   場合はノート単位の出典として degrade する（フィルタは fileId のみで判定）。
 * - blockText: 作成時点のブロックテキスト抜粋（表示用スナップショット兼、
 *   ブロック消失時の復旧手がかり。InlineHighlight.text と同じ発想）。
 */
export type MemoSourceNote = {
  fileId: string;
  title?: string;
  blockId?: string;
  blockText?: string;
};

/** 付箋キャプチャ1件 */
export type CaptureEntry = {
  /** 一意 ID */
  id: string;
  /** テキスト内容 */
  text: string;
  /** 作成日時 */
  createdAt: string;
  /** 最終編集日時 */
  modifiedAt?: string;
  /** 作成者メールアドレス */
  createdBy?: string;
  /** 挿入されたノート一覧 */
  usedIn?: MemoUsage[];
  /** 編集履歴（変更前テキストを保持） */
  editHistory?: MemoEditRecord[];
  /** 出典素材（Quote→Memo で保存された場合のみ） */
  sourceAsset?: MemoSourceAsset;
  /** 出典ノート（ノート右パネルの Memos タブから作成された場合のみ） */
  sourceNote?: MemoSourceNote;
  /** ナレッジ化して生成されたノート（ナレッジ化済みの記録・逆リンク） */
  knowledgedInto?: MemoKnowledged[];
  /** アーカイブ日時（ISO 文字列）。存在すれば一覧から退避するが参照・履歴は保持 */
  archivedAt?: string;
  /** ゴミ箱送り日時（ISO 文字列）。存在すれば一覧・アーカイブから除外。完全削除は removeCapture */
  deletedAt?: string;
};

/** キャプチャインデックス全体 */
export type CaptureIndex = {
  version: 1;
  updatedAt: string;
  captures: CaptureEntry[];
};

// ── 空インデックス ──

export function createEmptyCaptureIndex(): CaptureIndex {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    captures: [],
  };
}

// ── Drive API（Google Drive プロバイダー用） ──

function authedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  return getActiveProvider().authedFetch(url, options);
}

let cachedFolderId: string | null = null;
async function getFolderId(): Promise<string> {
  if (cachedFolderId) return cachedFolderId;
  // Graphium フォルダ（旧名 ProvNote からの互換性は google-drive.ts 側で処理済み）
  const query = `(name='Graphium' or name='ProvNote') and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await authedFetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name)&spaces=drive`
  );
  const data = await res.json();
  if (data.files?.[0]?.id) {
    cachedFolderId = data.files[0].id;
    return cachedFolderId!;
  }
  throw new Error("Graphium フォルダが見つかりません");
}

let cachedIndexFileId: string | null = null;

async function findIndexFileId(): Promise<string | null> {
  if (cachedIndexFileId) return cachedIndexFileId;
  const folderId = await getFolderId();
  const query = `name='${INDEX_FILE_NAME}' and '${folderId}' in parents and trashed=false`;
  const res = await authedFetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id)&spaces=drive`
  );
  const data = await res.json();
  if (data.files?.[0]?.id) {
    cachedIndexFileId = data.files[0].id;
    return cachedIndexFileId;
  }
  return null;
}

// ── 読み書き ──

/** キャプチャインデックスを読み込み */
export async function readCaptureIndex(): Promise<CaptureIndex | null> {
  const provider = getActiveProvider();
  if (provider.readAppData) {
    return (await provider.readAppData("captures")) as CaptureIndex | null;
  }
  // Google Drive
  const fileId = await findIndexFileId();
  if (!fileId) return null;
  const res = await authedFetch(`${DRIVE_API}/files/${fileId}?alt=media`);
  return res.json();
}

/** キャプチャインデックスを保存 */
export async function saveCaptureIndex(index: CaptureIndex): Promise<void> {
  index.updatedAt = new Date().toISOString();
  const provider = getActiveProvider();
  if (provider.writeAppData) {
    await provider.writeAppData("captures", index);
    return;
  }
  // Google Drive
  const fileId = await findIndexFileId();
  const body = JSON.stringify(index);

  if (fileId) {
    await authedFetch(`${UPLOAD_API}/files/${fileId}?uploadType=media`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
    });
  } else {
    const folderId = await getFolderId();
    const boundary = "graphium_captures_boundary";
    const metadata = JSON.stringify({ name: INDEX_FILE_NAME, parents: [folderId] });
    const multipart =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n` +
      `--${boundary}--`;

    const res = await authedFetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id`, {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: multipart,
    });
    const data = await res.json();
    cachedIndexFileId = data.id;
  }
}

// ── CRUD 操作 ──

/** 付箋を追加 */
export function addCapture(index: CaptureIndex, entry: CaptureEntry): CaptureIndex {
  return {
    ...index,
    updatedAt: new Date().toISOString(),
    captures: [entry, ...index.captures],
  };
}

/** 付箋を削除 */
export function removeCapture(index: CaptureIndex, captureId: string): CaptureIndex {
  return {
    ...index,
    updatedAt: new Date().toISOString(),
    captures: index.captures.filter((c) => c.id !== captureId),
  };
}

/** メモのテキストを編集 */
export function editCapture(index: CaptureIndex, captureId: string, newText: string): CaptureIndex {
  const now = new Date().toISOString();
  return {
    ...index,
    updatedAt: now,
    captures: index.captures.map((c) => {
      if (c.id !== captureId || c.text === newText) return c;
      const history = c.editHistory ?? [];
      return {
        ...c,
        text: newText,
        modifiedAt: now,
        editHistory: [...history, { editedAt: now, previousText: c.text }],
      };
    }),
  };
}

/** メモの usedIn に挿入記録を追加 */
export function recordMemoUsage(
  index: CaptureIndex,
  captureId: string,
  noteId: string,
  noteTitle: string,
): CaptureIndex {
  return {
    ...index,
    updatedAt: new Date().toISOString(),
    captures: index.captures.map((c) => {
      if (c.id !== captureId) return c;
      const usedIn = c.usedIn ?? [];
      // 同じノートへの重複記録を防ぐ
      if (usedIn.some((u) => u.noteId === noteId)) return c;
      return {
        ...c,
        usedIn: [...usedIn, { noteId, noteTitle, insertedAt: new Date().toISOString() }],
      };
    }),
  };
}

/** メモのナレッジ化記録を追加（同じノートへの重複記録は防ぐ） */
export function recordMemoKnowledged(
  index: CaptureIndex,
  captureId: string,
  noteId: string,
  noteTitle: string,
): CaptureIndex {
  return {
    ...index,
    updatedAt: new Date().toISOString(),
    captures: index.captures.map((c) => {
      if (c.id !== captureId) return c;
      const knowledgedInto = c.knowledgedInto ?? [];
      // 同じノートへの重複記録を防ぐ
      if (knowledgedInto.some((k) => k.noteId === noteId)) return c;
      return {
        ...c,
        knowledgedInto: [
          ...knowledgedInto,
          { noteId, noteTitle, knowledgedAt: new Date().toISOString() },
        ],
      };
    }),
  };
}

/** メモをアーカイブ（archivedAt をセット。ゴミ箱送りとは区別し参照は保持） */
export function archiveCapture(index: CaptureIndex, captureId: string): CaptureIndex {
  const now = new Date().toISOString();
  return {
    ...index,
    updatedAt: now,
    captures: index.captures.map((c) => (c.id === captureId ? { ...c, archivedAt: now } : c)),
  };
}

/** メモをアーカイブから復元（archivedAt を解除して active に戻す） */
export function restoreCaptureFromArchive(index: CaptureIndex, captureId: string): CaptureIndex {
  return {
    ...index,
    updatedAt: new Date().toISOString(),
    captures: index.captures.map((c) => {
      if (c.id !== captureId) return c;
      const next = { ...c };
      delete next.archivedAt;
      return next;
    }),
  };
}

/** メモをゴミ箱に送る（deletedAt をセット。物理削除は removeCapture） */
export function trashCapture(index: CaptureIndex, captureId: string): CaptureIndex {
  const now = new Date().toISOString();
  return {
    ...index,
    updatedAt: now,
    captures: index.captures.map((c) => (c.id === captureId ? { ...c, deletedAt: now } : c)),
  };
}

/** メモをゴミ箱から復元（deletedAt を解除して active に戻す） */
export function restoreCaptureFromTrash(index: CaptureIndex, captureId: string): CaptureIndex {
  return {
    ...index,
    updatedAt: new Date().toISOString(),
    captures: index.captures.map((c) => {
      if (c.id !== captureId) return c;
      const next = { ...c };
      delete next.deletedAt;
      return next;
    }),
  };
}

/** アーカイブ済みメモをゴミ箱に送る（archivedAt を解除し deletedAt へ付け替え） */
export function sendCaptureArchiveToTrash(index: CaptureIndex, captureId: string): CaptureIndex {
  const now = new Date().toISOString();
  return {
    ...index,
    updatedAt: now,
    captures: index.captures.map((c) => {
      if (c.id !== captureId) return c;
      const next = { ...c };
      delete next.archivedAt;
      next.deletedAt = now;
      return next;
    }),
  };
}

/** アクティブなメモ（アーカイブ・ゴミ箱を除く） */
export function getActiveCaptures(index: CaptureIndex): CaptureEntry[] {
  return index.captures.filter((c) => !c.archivedAt && !c.deletedAt);
}

/** アーカイブ済みメモ（ゴミ箱を除く） */
export function getArchivedCaptures(index: CaptureIndex): CaptureEntry[] {
  return index.captures.filter((c) => c.archivedAt && !c.deletedAt);
}

/** ゴミ箱のメモ */
export function getTrashedCaptures(index: CaptureIndex): CaptureEntry[] {
  return index.captures.filter((c) => c.deletedAt);
}

/** ID 生成 */
export function generateCaptureId(): string {
  return `cap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/** キャッシュリセット（認証切り替え時） */
export function clearCaptureCache(): void {
  cachedFolderId = null;
  cachedIndexFileId = null;
}
