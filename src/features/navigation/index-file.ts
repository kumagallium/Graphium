// .provnote-index.json の型定義と Drive 読み書き
// 全ノートのメタデータを1ファイルに集約し、一覧・検索・被参照計算を高速化する

import {
  listFiles,
  loadFile,
  type ProvNoteDocument,
  type ProvNoteFile,
} from "../../lib/google-drive";
import { getAccessToken } from "../../lib/google-auth";

// ── 型定義 ──

// インデックスのスキーマバージョン
// extractBlockText の改善等、インデックス構築ロジックが変わった場合にインクリメントする
const INDEX_SCHEMA_VERSION = 3;

export type ProvNoteIndex = {
  version: number;
  updatedAt: string;
  notes: NoteIndexEntry[];
};

export type NoteIndexEntry = {
  noteId: string;
  title: string;
  modifiedAt: string;
  createdAt: string;
  headings: {
    blockId: string;
    text: string;
    level: 2 | 3;
  }[];
  labels: {
    blockId: string;
    label: string;
    preview: string;
  }[];
  outgoingLinks: {
    targetNoteId: string;
    targetBlockId?: string;
    layer: "prov" | "knowledge";
  }[];
};

// ── Drive API ──

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const INDEX_FILE_NAME = ".provnote-index.json";

async function authedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getAccessToken();
  if (!token) throw new Error("未認証です");
  const res = await fetch(url, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Drive API エラー (${res.status}): ${body}`);
  }
  return res;
}

// ProvNote フォルダ ID を取得（google-drive.ts の getOrCreateFolder を再利用したいが、
// 循環 import を避けるため、ファイル検索で取得する）
let cachedFolderId: string | null = null;
async function getFolderId(): Promise<string> {
  if (cachedFolderId) return cachedFolderId;
  const query = `name='ProvNote' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await authedFetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id)&spaces=drive`
  );
  const data = await res.json();
  if (data.files?.[0]?.id) {
    cachedFolderId = data.files[0].id;
    return cachedFolderId!;
  }
  throw new Error("ProvNote フォルダが見つかりません");
}

// インデックスファイル ID のキャッシュ
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

// インデックスファイルを読み込み
export async function readIndexFile(): Promise<ProvNoteIndex | null> {
  const fileId = await findIndexFileId();
  if (!fileId) return null;
  const res = await authedFetch(`${DRIVE_API}/files/${fileId}?alt=media`);
  return res.json();
}

// インデックスファイルを保存（新規作成 or 上書き）
export async function saveIndexFile(index: ProvNoteIndex): Promise<void> {
  const fileId = await findIndexFileId();
  const body = JSON.stringify(index);

  if (fileId) {
    // 上書き
    await authedFetch(`${UPLOAD_API}/files/${fileId}?uploadType=media`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
    });
  } else {
    // 新規作成
    const folderId = await getFolderId();
    const boundary = "provnote_index_boundary";
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

// ── インデックスエントリ構築 ──

// ProvNoteDocument からインデックスエントリを構築
export function buildIndexEntry(
  noteId: string,
  doc: ProvNoteDocument,
  file?: ProvNoteFile,
): NoteIndexEntry {
  const page = doc.pages[0];
  const headings: NoteIndexEntry["headings"] = [];
  const labels: NoteIndexEntry["labels"] = [];
  const outgoingLinks: NoteIndexEntry["outgoingLinks"] = [];

  if (page) {
    // 見出しを収集
    for (const block of page.blocks || []) {
      if (block.type === "heading" && (block.props?.level === 2 || block.props?.level === 3)) {
        const text = extractInlineText(block.content);
        if (text) {
          headings.push({ blockId: block.id, text, level: block.props.level });
        }
      }
    }

    // ラベルを収集（子ブロックも再帰的に検索、テーブル・子要素のテキストも取得）
    // ブロックが削除済みでラベルだけ残っている場合はスキップ（ゴーストラベル除去）
    for (const [blockId, label] of Object.entries(page.labels || {})) {
      const block = findBlockById(page.blocks || [], blockId);
      if (!block) continue;
      const preview = extractBlockText(block).slice(0, 80);
      labels.push({ blockId, label: label as string, preview });
    }

    // provLinks からの出力リンク
    for (const link of page.provLinks || []) {
      if (link.targetNoteId) {
        outgoingLinks.push({
          targetNoteId: link.targetNoteId,
          targetBlockId: link.targetBlockId || undefined,
          layer: "prov",
        });
      }
    }

    // knowledgeLinks からの出力リンク
    for (const link of page.knowledgeLinks || []) {
      if (link.targetNoteId) {
        outgoingLinks.push({
          targetNoteId: link.targetNoteId,
          targetBlockId: link.targetBlockId || undefined,
          layer: "knowledge",
        });
      }
    }

    // indexTables からの出力リンク
    for (const linkedNotes of Object.values(page.indexTables || {})) {
      for (const targetNoteId of Object.values(linkedNotes as Record<string, string>)) {
        outgoingLinks.push({ targetNoteId, layer: "knowledge" });
      }
    }
  }

  // derivedFromNoteId
  if (doc.derivedFromNoteId) {
    outgoingLinks.push({ targetNoteId: doc.derivedFromNoteId, layer: "prov" });
  }
  // noteLinks
  if (doc.noteLinks) {
    for (const link of doc.noteLinks) {
      outgoingLinks.push({
        targetNoteId: link.targetNoteId,
        targetBlockId: link.sourceBlockId || undefined,
        layer: "prov",
      });
    }
  }

  return {
    noteId,
    title: doc.title,
    modifiedAt: file?.modifiedTime ?? doc.modifiedAt,
    createdAt: file?.createdTime ?? doc.createdAt,
    headings,
    labels,
    outgoingLinks,
  };
}

// ブロック配列から ID で再帰的に検索
function findBlockById(blocks: any[], id: string): any | undefined {
  for (const block of blocks) {
    if (block.id === id) return block;
    if (block.children?.length) {
      const found = findBlockById(block.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

// BlockNote のインラインコンテンツからテキストを抽出
function extractInlineText(content: any): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c: any) => c.text ?? c.content ?? "").join("");
  }
  // テーブルコンテンツ: { type: "tableContent", rows: [{ cells: [[...]] }] }
  if (content.type === "tableContent" && Array.isArray(content.rows)) {
    return content.rows
      .map((row: any) =>
        (row.cells ?? [])
          .map((cell: any) => extractInlineText(cell))
          .join(" ")
      )
      .join(" ")
      .trim();
  }
  return "";
}

// ブロックとその子ブロックからテキストを抽出
function extractBlockText(block: any): string {
  // 1. インラインコンテンツから直接取得
  let text = extractInlineText(block.content);
  if (text) return text;

  // 2. props.text (一部のブロック型)
  if (block.props?.text) return block.props.text;

  // 3. 子ブロックからテキストを再帰的に収集
  if (block.children?.length) {
    text = block.children
      .map((child: any) => extractBlockText(child))
      .filter(Boolean)
      .join(", ");
    if (text) return text;
  }

  // 4. content が文字列でない構造（フォールバック: JSON を文字列化して中身を探す）
  if (block.content) {
    try {
      const json = JSON.stringify(block.content);
      const texts = [...json.matchAll(/"text"\s*:\s*"([^"]+)"/g)].map(m => m[1]);
      if (texts.length > 0) return texts.join(" ");
    } catch {}
  }

  return "";
}

// ── インデックスの初期構築・差分更新 ──

// 起動時: インデックスを読み込み、古ければ再構築
export async function ensureIndex(
  files: ProvNoteFile[],
  docCache: Map<string, ProvNoteDocument>,
): Promise<ProvNoteIndex> {
  const existing = await readIndexFile();

  // 既存インデックスが最新かチェック（バージョン一致 + ファイル数一致 + 更新日が全て含まれている）
  if (existing && existing.version === INDEX_SCHEMA_VERSION && isIndexFresh(existing, files)) {
    return existing;
  }

  // インデックスが存在しないか古い → 全ノートから構築
  // キャッシュにないものは Drive から読み込み
  for (const file of files) {
    if (!docCache.has(file.id)) {
      try {
        const doc = await loadFile(file.id);
        docCache.set(file.id, doc);
      } catch {
        // スキップ
      }
    }
  }

  const entries: NoteIndexEntry[] = [];
  for (const file of files) {
    const doc = docCache.get(file.id);
    if (doc) {
      entries.push(buildIndexEntry(file.id, doc, file));
    }
  }

  const index: ProvNoteIndex = {
    version: INDEX_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    notes: entries,
  };

  // バックグラウンドで保存（UI をブロックしない）
  saveIndexFile(index).catch((err) => console.warn("インデックス保存失敗:", err));

  return index;
}

// インデックスがファイル一覧に対して最新かチェック
function isIndexFresh(index: ProvNoteIndex, files: ProvNoteFile[]): boolean {
  // ファイル数が一致しない → 古い
  if (index.notes.length !== files.length) return false;

  const indexMap = new Map(index.notes.map((n) => [n.noteId, n.modifiedAt]));
  for (const file of files) {
    const indexModified = indexMap.get(file.id);
    // インデックスに含まれていない or 更新日が古い → 再構築
    if (!indexModified) return false;
    if (new Date(file.modifiedTime).getTime() > new Date(indexModified).getTime() + 1000) {
      return false;
    }
  }
  return true;
}

// ノート保存時: 該当エントリだけ差分更新
export function updateIndexEntry(
  index: ProvNoteIndex,
  noteId: string,
  doc: ProvNoteDocument,
  file?: ProvNoteFile,
): ProvNoteIndex {
  const entry = buildIndexEntry(noteId, doc, file);
  const notes = index.notes.filter((n) => n.noteId !== noteId);
  notes.push(entry);
  return { ...index, updatedAt: new Date().toISOString(), notes };
}

// ノート削除時: エントリを除去
export function removeIndexEntry(
  index: ProvNoteIndex,
  noteId: string,
): ProvNoteIndex {
  return {
    ...index,
    updatedAt: new Date().toISOString(),
    notes: index.notes.filter((n) => n.noteId !== noteId),
  };
}
