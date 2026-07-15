// 版スナップショットの永続化。
//
// StorageProvider.readAppData / writeAppData（3 プロバイダ全実装済みの内部チャネル）を使い、
//   snapshot-index:<noteId>  → SnapshotMeta[]        （リスト表示用・軽量）
//   snapshot:<snapshotId>    → GraphiumDocument      （全文・開くとき遅延ロード）
// の 2 層で持つ。listFiles を通らないのでノート一覧・検索・グラフに出ない（§設計メモ §4）。

import type { GraphiumDocument } from "../../lib/document-types";
import type { StorageProvider } from "../../lib/storage/types";
import { computePageHash } from "../document-provenance/diff";
import type { SnapshotMeta } from "./types";

const indexKey = (noteId: string) => `snapshot-index:${noteId}`;
const docKey = (snapshotId: string) => `snapshot:${snapshotId}`;

/** 版の全文ハッシュ。既存 recordRevision と同じく pages[0] を対象にする */
async function snapshotHash(doc: GraphiumDocument): Promise<string> {
  const page = doc.pages[0];
  if (!page) return "";
  return computePageHash(page);
}

/** ノートの版メタ一覧を version 昇順で返す（未保存なら空配列） */
export async function listSnapshots(
  provider: StorageProvider,
  noteId: string,
): Promise<SnapshotMeta[]> {
  const raw = await provider.readAppData?.(indexKey(noteId));
  if (!Array.isArray(raw)) return [];
  return (raw as SnapshotMeta[]).slice().sort((a, b) => a.version - b.version);
}

/** 版の全文ドキュメントを取得（存在しなければ null） */
export async function loadSnapshot(
  provider: StorageProvider,
  snapshotId: string,
): Promise<GraphiumDocument | null> {
  const raw = await provider.readAppData?.(docKey(snapshotId));
  return raw ? (raw as GraphiumDocument) : null;
}

export type TakeSnapshotResult =
  | { status: "created"; meta: SnapshotMeta }
  | { status: "unchanged"; meta: SnapshotMeta };

/**
 * 現在の doc を新しい版として残す。
 * 直近の版と内容ハッシュが同一なら版を作らず "unchanged"（＝「変更がありません」）を返す。
 *
 * 全文を先に書き、成功後にメタ index を更新する。こうすると index が指す全文が必ず存在する
 * （途中失敗で index だけ進んで実体が無い、という不整合を避ける）。逆に全文だけ残る孤児は
 * 実害がなく、将来 GC できる。
 */
export async function takeSnapshot(
  provider: StorageProvider,
  noteId: string,
  doc: GraphiumDocument,
  label?: string,
): Promise<TakeSnapshotResult> {
  if (!provider.writeAppData || !provider.readAppData) {
    throw new Error("この保存先は版の記録に対応していません");
  }
  const metas = await listSnapshots(provider, noteId);
  const contentHash = await snapshotHash(doc);
  const last = metas[metas.length - 1];
  if (last && last.contentHash === contentHash) {
    return { status: "unchanged", meta: last };
  }
  const meta: SnapshotMeta = {
    id: crypto.randomUUID(),
    noteId,
    version: (last?.version ?? 0) + 1,
    label: label?.trim() || undefined,
    savedAt: new Date().toISOString(),
    contentHash,
  };
  await provider.writeAppData(docKey(meta.id), doc);
  await provider.writeAppData(indexKey(noteId), [...metas, meta]);
  return { status: "created", meta };
}

/** 版のラベルを変更（未指定・空文字なら未命名に戻す） */
export async function renameSnapshot(
  provider: StorageProvider,
  noteId: string,
  snapshotId: string,
  label: string,
): Promise<void> {
  if (!provider.writeAppData) return;
  const metas = await listSnapshots(provider, noteId);
  const next = metas.map((m) =>
    m.id === snapshotId ? { ...m, label: label.trim() || undefined } : m,
  );
  await provider.writeAppData(indexKey(noteId), next);
}

/**
 * 版を削除する（メタ index から外し、全文を論理削除）。
 * プロバイダに appData の delete API が無いため、全文は writeAppData(key, null) で null 上書きする
 * （loadSnapshot は null を「無い」として扱う）。
 */
export async function deleteSnapshot(
  provider: StorageProvider,
  noteId: string,
  snapshotId: string,
): Promise<void> {
  if (!provider.writeAppData) return;
  const metas = await listSnapshots(provider, noteId);
  await provider.writeAppData(indexKey(noteId), metas.filter((m) => m.id !== snapshotId));
  await provider.writeAppData(docKey(snapshotId), null);
}
