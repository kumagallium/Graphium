// 画面から呼ぶ封印の操作をまとめたもの（note-app を薄く保つため）。
//
// - sealAndTimestamp: 固定 → 時刻の証明を付ける（失敗しても固定は成立させる）
// - summarizeSeals: 履歴パネルの行に出す要約（証明時刻・確定待ち・問題の有無）
// - verifySealReport: 「固定した内容を確かめる」の結果
// - retryPendingProofs: ノートを開いたときに、確定待ちの証明を裏で付け直す

import type { StorageProvider } from "../../lib/storage/types";
import { getLatestMediaIndex } from "../asset-browser/media-index";
import { loadAuthorIdentity } from "../identity/store";
import { listSnapshots } from "../version-snapshots/snapshot-store";
import type { SnapshotMeta } from "../version-snapshots/types";
import type { SnapshotRowSeal } from "../version-snapshots/SnapshotRow";
import { sha256HexOfText, type MediaInfoLookup } from "./manifest";
import { inspectTimeStampResponse } from "./rfc3161";
import {
  attachRfc3161,
  checkReceipts,
  loadReceiptBytes,
  type AttachResult,
  type ReceiptCheck,
} from "./receipts";
import {
  checkSealChain,
  checkSealLocally,
  loadSealText,
  sealSnapshot,
  type ChainProblem,
  type LocalSealCheck,
} from "./seal-store";

/** 素材インデックスから名前と MIME を引く */
function mediaLookup(): MediaInfoLookup {
  const index = getLatestMediaIndex();
  const map = new Map((index?.media ?? []).map((e) => [e.fileId, e]));
  return (fileId) => {
    const e = map.get(fileId);
    return e ? { name: e.name, mimeType: e.mimeType } : undefined;
  };
}

export interface SealAndTimestampResult {
  sealed: boolean;
  proofs: AttachResult[];
}

/**
 * 版を固定し、時刻の証明を付ける。
 * 封印した人は自己申告の名前だけを入れる（メールアドレスは書き出す証拠に入れない）。
 */
export async function sealAndTimestamp(
  provider: StorageProvider,
  noteId: string,
  snapshotId: string,
): Promise<SealAndTimestampResult> {
  const identity = loadAuthorIdentity();
  const res = await sealSnapshot(provider, {
    noteId,
    snapshotId,
    author: identity ? { name: identity.name } : null,
    lookupMedia: mediaLookup(),
  });
  const proofs: AttachResult[] = [];
  proofs.push(await attachRfc3161(provider, noteId, snapshotId));
  return { sealed: res.status === "sealed" || res.status === "already_sealed", proofs };
}

/** 受領書から証明時刻を読む（壊れていれば null） */
async function provenAtOf(provider: StorageProvider, meta: SnapshotMeta): Promise<Date | null> {
  let earliest: Date | null = null;
  for (const r of meta.seal?.receipts ?? []) {
    if (r.status !== "confirmed") continue;
    const bytes = await loadReceiptBytes(provider, r.receiptKey);
    if (!bytes) continue;
    try {
      if (r.kind === "rfc3161") {
        const t = inspectTimeStampResponse(bytes).genTime;
        if (!earliest || t < earliest) earliest = t;
      }
    } catch {
      // 壊れた受領書は時刻に数えない（「確かめる」で詳しく出す）
    }
  }
  return earliest;
}

/** 履歴パネルの行に出す要約を作る（固定した版だけ） */
export async function summarizeSeals(
  provider: StorageProvider,
  metas: SnapshotMeta[],
): Promise<Record<string, SnapshotRowSeal>> {
  const out: Record<string, SnapshotRowSeal> = {};
  for (const meta of metas) {
    if (!meta.seal) continue;
    const text = await loadSealText(provider, meta.id);
    const problem = text === null || (await sha256HexOfText(text)) !== meta.seal.sealHash;
    const provenAt = await provenAtOf(provider, meta);
    out[meta.id] = {
      ...(provenAt ? { provenAt: provenAt.toISOString() } : {}),
      pending: meta.seal.receipts.filter((r) => r.status !== "confirmed").length,
      ...(problem ? { problem: true } : {}),
    };
  }
  return out;
}

export interface SealReport {
  local: LocalSealCheck;
  receipts: ReceiptCheck[];
  chain: { count: number; problems: ChainProblem[] };
}

/** 「固定した内容を確かめる」: 封印ファイル・素材・受領書・連鎖をまとめて照合する */
export async function verifySealReport(
  provider: StorageProvider,
  noteId: string,
  snapshotId: string,
): Promise<SealReport | null> {
  const meta = (await listSnapshots(provider, noteId)).find((m) => m.id === snapshotId);
  if (!meta?.seal) return null;
  const [local, receipts, chain] = await Promise.all([
    checkSealLocally(provider, meta),
    checkReceipts(provider, meta),
    checkSealChain(provider, noteId),
  ]);
  return { local, receipts, chain };
}

/** 同じセッションで同じ版を何度も付け直しに行かないための記録 */
const retried = new Set<string>();

/**
 * 確定待ちの証明を付け直す（ノートを開いたときに裏で呼ぶ）。通知は出さない。
 * 付け直したものがあれば true（呼び出し側は一覧を読み直す）。
 */
export async function retryPendingProofs(
  provider: StorageProvider,
  noteId: string,
  metas: SnapshotMeta[],
): Promise<boolean> {
  let changed = false;
  for (const meta of metas) {
    if (!meta.seal || retried.has(meta.id)) continue;
    const pending = meta.seal.receipts.filter((r) => r.status !== "confirmed");
    const hasRfc = meta.seal.receipts.some((r) => r.kind === "rfc3161");
    if (pending.length === 0 && hasRfc) continue;
    retried.add(meta.id);
    if (pending.some((r) => r.kind === "rfc3161") || !hasRfc) {
      const res = await attachRfc3161(provider, noteId, meta.id);
      if (res.status === "confirmed") changed = true;
    }
  }
  return changed;
}
