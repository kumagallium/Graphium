// 版の封印の保存と、アプリ内での検証。
//
// appData のキー（`:` を使わない。listAppDataKeys / deleteAppData の規則にも収まる）:
//   seal-<snapshotId>                 → 封印ファイルの文字列（正本。パースし直して書き戻さない）
//   seal-receipt-<snapshotId>-<n>     → 時刻証明の受領書（base64）
// 版のメタ（snapshot-index:<noteId>）には要約（SnapshotSeal）だけを足す。

import type { StorageProvider } from "../../lib/storage/types";
import {
  listSnapshots,
  loadSnapshot,
  updateSnapshotMeta,
} from "../version-snapshots/snapshot-store";
import type { SnapshotMeta } from "../version-snapshots/types";
import {
  buildSealManifest,
  collectSealMediaRefs,
  hashSealMedia,
  parseSealManifest,
  sha256HexOfBytes,
  sha256HexOfText,
  SEAL_MEDIA_MAX_BYTES,
  type MediaInfoLookup,
  type ReadMediaForSeal,
} from "./manifest";
import type { SealAuthor, SealManifest, SnapshotSeal } from "./types";

export const sealKey = (snapshotId: string) => `seal-${snapshotId}`;
export const receiptKey = (snapshotId: string, n: number) => `seal-receipt-${snapshotId}-${n}`;

/** 封印できない版を封印しようとしたとき */
export class NotSealableError extends Error {
  constructor(reason: "not_found" | "auto_snapshot" | "no_document" | "unsupported") {
    super(`この版は封印できません（${reason}）`);
    this.name = "NotSealableError";
    this.reason = reason;
  }
  reason: "not_found" | "auto_snapshot" | "no_document" | "unsupported";
}

/** 封印できる版か（人が残した版だけ。AI が自動で残した版は対象外） */
export function isSealable(meta: SnapshotMeta): boolean {
  return meta.origin === undefined;
}

/** プロバイダの素材読み出しを封印用の形に包む */
export function makeMediaReader(provider: StorageProvider): ReadMediaForSeal {
  return async (fileId, maxBytes) => {
    if (provider.readMediaBytes) {
      const bytes = await provider.readMediaBytes(fileId, maxBytes);
      if (bytes) return { bytes };
    }
    // 原文テキスト（URL の Reader 抽出結果など）はバイナリと別チャネルに置かれている
    if (provider.loadMediaText) {
      const text = await provider.loadMediaText(fileId);
      if (typeof text === "string") {
        const bytes = new TextEncoder().encode(text);
        return bytes.byteLength > maxBytes ? { tooLarge: true } : { bytes };
      }
    }
    // readMediaBytes は上限超えでも未存在でも undefined なので、ここでは区別できない。
    // 上限超えかどうかは呼び出し側が上限なしで読み直さずに「読めなかった」とする
    return null;
  };
}

export interface SealSnapshotOptions {
  noteId: string;
  snapshotId: string;
  author: SealAuthor | null;
  /** 素材の名前・MIME を引く（素材インデックス）。無ければ名前なしで入れる */
  lookupMedia?: MediaInfoLookup;
  /** テスト用 */
  readMedia?: ReadMediaForSeal;
  now?: () => Date;
  maxMediaBytes?: number;
}

export type SealSnapshotResult =
  | { status: "sealed"; meta: SnapshotMeta; manifest: SealManifest }
  | { status: "already_sealed"; meta: SnapshotMeta };

/** 版の封印のうち、通し番号が最後のもの（連鎖の直前） */
function lastSealed(metas: SnapshotMeta[]): SnapshotMeta | undefined {
  const sealed = metas
    .filter((m) => m.seal)
    .sort((a, b) => a.seal!.sealIndex - b.seal!.sealIndex);
  return sealed[sealed.length - 1];
}

/**
 * 版を封印する。
 * 1) 版の全文と素材のハッシュから封印ファイルを作る
 * 2) 封印ファイルを先に保存し、成功したら版のメタに要約を書く
 *    （メタだけ進んで封印ファイルが無い、という状態を作らない）
 * 時刻証明は別の段（受領書の追加）で行う。封印そのものはオフラインでも成立させる。
 */
export async function sealSnapshot(
  provider: StorageProvider,
  opts: SealSnapshotOptions,
): Promise<SealSnapshotResult> {
  if (!provider.readAppData || !provider.writeAppData) throw new NotSealableError("unsupported");
  const metas = await listSnapshots(provider, opts.noteId);
  const meta = metas.find((m) => m.id === opts.snapshotId);
  if (!meta) throw new NotSealableError("not_found");
  if (meta.seal) return { status: "already_sealed", meta };
  if (!isSealable(meta)) throw new NotSealableError("auto_snapshot");
  const doc = await loadSnapshot(provider, meta.id);
  if (!doc) throw new NotSealableError("no_document");

  const refs = collectSealMediaRefs(doc, (url) => provider.extractFileId(url));
  const media = await hashSealMedia(
    refs,
    opts.readMedia ?? makeMediaReader(provider),
    opts.lookupMedia ?? (() => undefined),
    opts.maxMediaBytes ?? SEAL_MEDIA_MAX_BYTES,
  );

  const sealedAt = (opts.now?.() ?? new Date()).toISOString();
  // 連鎖の番号はメタを書く直前に決め直す（並んだ封印が同じ番号を取らないように）
  const prev = lastSealed(metas);
  const sealIndex = (prev?.seal?.sealIndex ?? 0) + 1;
  const { text, sealHash, manifest } = await buildSealManifest({
    noteId: opts.noteId,
    snapshotId: meta.id,
    version: meta.version,
    label: meta.label,
    snapshotSavedAt: meta.savedAt,
    sealedAt,
    sealIndex,
    prevSealHash: prev?.seal?.sealHash ?? null,
    author: opts.author,
    document: doc,
    media,
  });

  await provider.writeAppData(sealKey(meta.id), text);
  const seal: SnapshotSeal = { sealedAt, sealHash, sealIndex, receipts: [] };
  let conflict = false;
  const updated = await updateSnapshotMeta(provider, opts.noteId, meta.id, (m, all) => {
    if (m.seal) return null;
    // 待っている間に別の封印が進んでいたら、連鎖が食い違うのでやり直してもらう
    const latest = lastSealed(all);
    if ((latest?.seal?.sealHash ?? null) !== (prev?.seal?.sealHash ?? null)) {
      conflict = true;
      return null;
    }
    return { ...m, seal };
  });
  if (!updated) throw new NotSealableError("not_found");
  if (conflict) throw new Error("ほかの封印と重なりました。もう一度お試しください");
  if (!updated.seal || updated.seal.sealHash !== sealHash) {
    return { status: "already_sealed", meta: updated };
  }
  return { status: "sealed", meta: updated, manifest };
}

/** 保存済みの封印ファイルの文字列（無ければ null） */
export async function loadSealText(
  provider: StorageProvider,
  snapshotId: string,
): Promise<string | null> {
  const raw = await provider.readAppData?.(sealKey(snapshotId));
  return typeof raw === "string" ? raw : null;
}

export type MediaCheck = {
  fileId: string;
  name?: string;
  /** same: 今の素材と封印時の中身が同じ / changed: 変わった / missing: 読めない / skipped: 封印時にハッシュを取れなかった */
  status: "same" | "changed" | "missing" | "skipped";
};

export interface LocalSealCheck {
  /** 封印ファイルが見つかったか */
  found: boolean;
  /** 封印ファイルの SHA-256 がメタの sealHash と一致するか */
  manifestIntact: boolean;
  /** 封印ファイルの中身（形式が正しいときだけ） */
  manifest: SealManifest | null;
  media: MediaCheck[];
}

/** 1 つの封印をアプリ内で照合する（時刻証明の照合は受領書の側で行う） */
export async function checkSealLocally(
  provider: StorageProvider,
  meta: SnapshotMeta,
  readMedia: ReadMediaForSeal = makeMediaReader(provider),
): Promise<LocalSealCheck> {
  if (!meta.seal) return { found: false, manifestIntact: false, manifest: null, media: [] };
  const text = await loadSealText(provider, meta.id);
  if (text === null) return { found: false, manifestIntact: false, manifest: null, media: [] };
  const manifestIntact = (await sha256HexOfText(text)) === meta.seal.sealHash;
  const manifest = parseSealManifest(text);
  const media: MediaCheck[] = [];
  for (const m of manifest?.media ?? []) {
    if (!m.sha256) {
      media.push({ fileId: m.fileId, name: m.name, status: "skipped" });
      continue;
    }
    let res: Awaited<ReturnType<ReadMediaForSeal>> = null;
    try {
      res = await readMedia(m.fileId, Number.MAX_SAFE_INTEGER);
    } catch {
      res = null;
    }
    if (!res || !("bytes" in res)) {
      media.push({ fileId: m.fileId, name: m.name, status: "missing" });
      continue;
    }
    const now = `sha256:${await sha256HexOfBytes(res.bytes)}`;
    media.push({ fileId: m.fileId, name: m.name, status: now === m.sha256 ? "same" : "changed" });
  }
  return { found: true, manifestIntact, manifest, media };
}

export type ChainProblem =
  /** 封印ファイルが見つからない */
  | { kind: "missing_file"; sealIndex: number; snapshotId: string }
  /** 封印ファイルの中身がメタのハッシュと合わない */
  | { kind: "tampered"; sealIndex: number; snapshotId: string }
  /** 通し番号に抜けがある（間の封印が消された） */
  | { kind: "gap"; afterIndex: number; beforeIndex: number }
  /** 直前の封印のハッシュと、次の封印が覚えているハッシュが合わない */
  | { kind: "link_mismatch"; sealIndex: number };

/**
 * ノートの封印の連鎖を確かめる。
 * いちばん新しい封印を消された場合は分からない（後ろに証人がいないため）。
 */
export async function checkSealChain(
  provider: StorageProvider,
  noteId: string,
): Promise<{ count: number; problems: ChainProblem[] }> {
  const sealed = (await listSnapshots(provider, noteId))
    .filter((m) => m.seal)
    .sort((a, b) => a.seal!.sealIndex - b.seal!.sealIndex);
  const problems: ChainProblem[] = [];
  let prevIndex = 0;
  let prevHash: string | null = null;
  for (const m of sealed) {
    const s = m.seal!;
    if (s.sealIndex !== prevIndex + 1) {
      problems.push({ kind: "gap", afterIndex: prevIndex, beforeIndex: s.sealIndex });
    }
    const text = await loadSealText(provider, m.id);
    if (text === null) {
      problems.push({ kind: "missing_file", sealIndex: s.sealIndex, snapshotId: m.id });
    } else {
      if ((await sha256HexOfText(text)) !== s.sealHash) {
        problems.push({ kind: "tampered", sealIndex: s.sealIndex, snapshotId: m.id });
      }
      const manifest = parseSealManifest(text);
      // 抜けの直後は直前のハッシュを知らないので、つながりの照合はしない
      if (manifest && s.sealIndex === prevIndex + 1 && manifest.prevSealHash !== prevHash) {
        problems.push({ kind: "link_mismatch", sealIndex: s.sealIndex });
      }
    }
    prevIndex = s.sealIndex;
    prevHash = s.sealHash;
  }
  return { count: sealed.length, problems };
}
