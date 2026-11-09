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

/** 封印した版を削除・改名しようとしたときのエラー */
export class SealedSnapshotError extends Error {
  constructor() {
    super("封印した版は削除・名前の変更ができません");
    this.name = "SealedSnapshotError";
  }
}

// snapshot-index:<noteId> は「読む → 変える → 全部書き戻す」方式なので、版を残す操作と
// AI の自動版・封印の更新が並ぶと、後から書いた側が先の変更を消してしまう。
// ノートごとに書き込みを 1 本の列に並べて直列化する。
// ブラウザの Web Locks（navigator.locks）があれば、同じ端末の別のタブとも列を共有する
// （Web 版で 2 つのタブが同じノートの版を同時に書くと、後から書いた側が封印の記録を消しうるため）。
// 無い環境（テストの Node など）では、同じタブの中だけで並べる。
const indexLocks = new Map<string, Promise<unknown>>();

type LockManagerLike = { request: <T>(name: string, cb: () => Promise<T>) => Promise<T> };

function webLocks(): LockManagerLike | null {
  const locks = (globalThis as { navigator?: { locks?: LockManagerLike } }).navigator?.locks;
  return locks && typeof locks.request === "function" ? locks : null;
}

function withIndexLock<T>(noteId: string, fn: () => Promise<T>): Promise<T> {
  const locks = webLocks();
  if (locks) return locks.request(`graphium-snapshot-index-${noteId}`, () => fn());
  const prev = indexLocks.get(noteId) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  const tail = run.catch(() => undefined);
  indexLocks.set(noteId, tail);
  void tail.then(() => {
    if (indexLocks.get(noteId) === tail) indexLocks.delete(noteId);
  });
  return run;
}

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
 * force は本文以外のメタデータも含め、その時点の全文を必ず残す操作で使う。
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
  origin?: SnapshotMeta["origin"],
  force = false,
): Promise<TakeSnapshotResult> {
  if (!provider.writeAppData || !provider.readAppData) {
    throw new Error("この保存先は版の記録に対応していません");
  }
  return withIndexLock(noteId, () =>
    takeSnapshotLocked(provider, noteId, doc, label, origin, force),
  );
}

async function takeSnapshotLocked(
  provider: StorageProvider,
  noteId: string,
  doc: GraphiumDocument,
  label: string | undefined,
  origin: SnapshotMeta["origin"],
  force: boolean,
): Promise<TakeSnapshotResult> {
  const writeAppData = provider.writeAppData!;
  const metas = await listSnapshots(provider, noteId);
  const contentHash = await snapshotHash(doc);
  const last = metas[metas.length - 1];
  if (!force && last && last.contentHash === contentHash) {
    return { status: "unchanged", meta: last };
  }
  const meta: SnapshotMeta = {
    id: crypto.randomUUID(),
    noteId,
    version: (last?.version ?? 0) + 1,
    label: label?.trim() || undefined,
    savedAt: new Date().toISOString(),
    contentHash,
    origin,
  };
  await writeAppData(docKey(meta.id), doc);
  await writeAppData(indexKey(noteId), [...metas, meta]);
  return { status: "created", meta };
}

/**
 * 版の全文で「現在のドキュメント」を上書きするための復元ドキュメントを組む。
 * 内容（title / pages / 内容系メタ）は版から取り、管理系メタ（作成日時・
 * 編集履歴チェーン・共有参照・スキルの版同期情報）は現在の文書から引き継ぐ。
 * 復元後の recordRevision（snapshot_restore）は呼び出し側で行う。
 */
export function buildRestoredDocument(
  current: GraphiumDocument,
  snapshot: GraphiumDocument,
): GraphiumDocument {
  return {
    ...snapshot,
    createdAt: current.createdAt,
    documentProvenance: current.documentProvenance,
    sharedRef: current.sharedRef,
    modifiedAt: new Date().toISOString(),
    skillMeta: current.skillMeta && snapshot.skillMeta
      ? current.skillMeta.systemSkillId === "knowledge-schema" &&
        snapshot.skillMeta.systemSkillId === "knowledge-schema"
        ? {
          ...snapshot.skillMeta,
          createdAt: current.skillMeta.createdAt,
        }
        : {
          ...snapshot.skillMeta,
          createdAt: current.skillMeta.createdAt,
          // 版同期の管理情報は現在を維持する。復元した内容が同梱デフォルトと
          // 違えば、通常の編集と同じく起動時のハッシュ比較で「編集済み」になる。
          systemSkillVersion: current.skillMeta.systemSkillVersion,
          defaultPromptHash: current.skillMeta.defaultPromptHash,
        }
      : (snapshot.skillMeta ?? current.skillMeta),
  };
}

/** 版のラベルを変更（未指定・空文字なら未命名に戻す）。封印した版は SealedSnapshotError */
export async function renameSnapshot(
  provider: StorageProvider,
  noteId: string,
  snapshotId: string,
  label: string,
): Promise<void> {
  const writeAppData = provider.writeAppData;
  if (!writeAppData) return;
  await withIndexLock(noteId, async () => {
    const metas = await listSnapshots(provider, noteId);
    if (metas.find((m) => m.id === snapshotId)?.seal) throw new SealedSnapshotError();
    const next = metas.map((m) =>
      m.id === snapshotId ? { ...m, label: label.trim() || undefined } : m,
    );
    await writeAppData(indexKey(noteId), next);
  });
}

/**
 * 版のメタを 1 件だけ書き換える（封印の要約の更新用）。
 * updater が null を返したら何も書かない。対象が無ければ null を返す。
 */
export async function updateSnapshotMeta(
  provider: StorageProvider,
  noteId: string,
  snapshotId: string,
  updater: (meta: SnapshotMeta, all: SnapshotMeta[]) => SnapshotMeta | null,
  /** メタを書き戻す直前に、同じロックの中で行う書き込み（更新が採用されるときだけ呼ぶ） */
  beforeWrite?: (next: SnapshotMeta) => Promise<void>,
): Promise<SnapshotMeta | null> {
  const writeAppData = provider.writeAppData;
  if (!writeAppData) throw new Error("この保存先は版の記録に対応していません");
  return withIndexLock(noteId, async () => {
    const metas = await listSnapshots(provider, noteId);
    const current = metas.find((m) => m.id === snapshotId);
    if (!current) return null;
    const next = updater(current, metas);
    if (!next) return current;
    if (beforeWrite) await beforeWrite(next);
    await writeAppData(
      indexKey(noteId),
      metas.map((m) => (m.id === snapshotId ? next : m)),
    );
    return next;
  });
}

/**
 * 版を削除する（メタ index から外し、全文を論理削除）。
 * 全文は writeAppData(key, null) で null 上書きする（loadSnapshot は null を「無い」として扱う）。
 * 封印した版は SealedSnapshotError（画面には削除の手段を出さないが、経路でも止める）。
 */
export async function deleteSnapshot(
  provider: StorageProvider,
  noteId: string,
  snapshotId: string,
): Promise<void> {
  const writeAppData = provider.writeAppData;
  if (!writeAppData) return;
  await withIndexLock(noteId, async () => {
    const metas = await listSnapshots(provider, noteId);
    if (metas.find((m) => m.id === snapshotId)?.seal) throw new SealedSnapshotError();
    await writeAppData(indexKey(noteId), metas.filter((m) => m.id !== snapshotId));
    await writeAppData(docKey(snapshotId), null);
  });
}
