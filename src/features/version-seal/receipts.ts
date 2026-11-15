// 封印への時刻証明（受領書）の取り付けと検証。画面側で動く。
//
// RFC 3161: sidecar（/api/seal/rfc3161）に封印ファイルのハッシュだけを渡し、返ってきた応答を
// 封印ファイルの全文と同梱のルート証明書で検証してから保存する。通らなければ保存しない。
// 失敗（オフライン・局の停止）は "pending" として残し、あとで付け直す。封印そのものは成立させる。

import type { StorageProvider } from "../../lib/storage/types";
import { apiBase } from "../../lib/platform";
import { listSnapshots, updateSnapshotMeta } from "../version-snapshots/snapshot-store";
import type { SnapshotMeta } from "../version-snapshots/types";
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  hexToBytes,
  inspectTimeStampResponse,
  verifyTimeStampResponse,
} from "./rfc3161";
import {
  applyUpgrade,
  blindDigest,
  buildBlindedOts,
  countAttestations,
  MAX_ATTESTATIONS_PER_RESPONSE,
  listBitcoinClaims,
  listPending,
  parseOts,
  parseTimestampBody,
  type OtsFile,
  serializeOts,
  verifyOts,
} from "./opentimestamps";
import { loadSealText, receiptKey } from "./seal-store";
import { DEFAULT_TSA_ID, findTsa, isKnownCalendar, TSA_REGISTRY } from "./tsa-registry";
import type { SealReceipt } from "./types";

export type AttachResult =
  /** genTime は証明された時刻（既に確定していて読み直していないときは省く） */
  | { status: "confirmed"; genTime?: Date }
  | { status: "pending"; message: string }
  /** この環境（sidecar の無い Web 版など）では送れない */
  | { status: "unsupported" }
  | { status: "not_sealed" };

type PostJson = (url: string, body: unknown) => Promise<{ status: number; json: unknown }>;
type GetJson = (url: string) => Promise<{ status: number; json: unknown }>;

const defaultGet: GetJson = async (url) => {
  const res = await fetch(url);
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
};

/** ブロックヘッダを sidecar 経由で取る（照合に使う） */
export function makeHeaderFetcher(get: GetJson = defaultGet): (height: number) => Promise<string> {
  const cache = new Map<number, string>();
  return async (height) => {
    const hit = cache.get(height);
    if (hit) return hit;
    const res = await get(`${apiBase()}/seal/btc-header/${height}`);
    const header = (res.json as { header?: unknown } | null)?.header;
    if (res.status !== 200 || typeof header !== "string") throw new Error(`HTTP ${res.status}`);
    cache.set(height, header);
    return header;
  };
}

const defaultPost: PostJson = async (url, body) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
};

/** 受領書の本体（base64 の文字列）を読む */
export async function loadReceiptBytes(
  provider: StorageProvider,
  key: string,
): Promise<Uint8Array | null> {
  const raw = await provider.readAppData?.(key);
  if (typeof raw !== "string" || !raw) return null;
  try {
    return base64ToBytes(raw);
  } catch {
    return null;
  }
}

/** その受領書の、これまでの続けての失敗回数 */
function failuresOf(receipts: SealReceipt[], key: string): number {
  return receipts.find((r) => r.receiptKey === key)?.failures ?? 0;
}

/** 失敗が続いた受領書は、付け直しを 7 日に 1 回へ控える */
export const RETRY_BACKOFF_AFTER = 5;
export const RETRY_BACKOFF_MS = 7 * 24 * 60 * 60 * 1000;

export function isBackedOff(receipt: SealReceipt | undefined, now: Date = new Date()): boolean {
  if (!receipt || (receipt.failures ?? 0) < RETRY_BACKOFF_AFTER) return false;
  const last = Date.parse(receipt.updatedAt);
  return Number.isFinite(last) && now.getTime() - last < RETRY_BACKOFF_MS;
}

/** 受領書のメタを足す・置き換える（同じ kind の pending があればそれを置き換える） */
function upsertReceipt(receipts: SealReceipt[], next: SealReceipt): SealReceipt[] {
  const i = receipts.findIndex((r) => r.receiptKey === next.receiptKey);
  if (i === -1) return [...receipts, next];
  return receipts.map((r, j) => (j === i ? next : r));
}

/** この kind の受領書に使うキー（pending があればそれを使い回す） */
function keyFor(meta: SnapshotMeta, kind: SealReceipt["kind"]): string {
  const receipts = meta.seal?.receipts ?? [];
  const pending = receipts.find((r) => r.kind === kind && r.status !== "confirmed");
  return pending?.receiptKey ?? receiptKey(meta.id, receipts.length + 1);
}

/**
 * 封印に RFC 3161 の受領書を付ける。
 * 既に確定した RFC 3161 の受領書があれば何もしない（局ごとに 1 件で足りる）。
 */
export async function attachRfc3161(
  provider: StorageProvider,
  noteId: string,
  snapshotId: string,
  opts: { tsaId?: string; post?: PostJson; now?: () => Date } = {},
): Promise<AttachResult> {
  if (!provider.writeAppData) return { status: "unsupported" };
  const tsa = findTsa(opts.tsaId ?? DEFAULT_TSA_ID);
  if (!tsa) return { status: "unsupported" };
  const meta = (await listSnapshots(provider, noteId)).find((m) => m.id === snapshotId);
  if (!meta?.seal) return { status: "not_sealed" };
  const done = meta.seal.receipts.find(
    (r) => r.kind === "rfc3161" && r.endpoint === tsa.url && r.status === "confirmed",
  );
  if (done) {
    const bytes = await loadReceiptBytes(provider, done.receiptKey);
    if (bytes) return { status: "confirmed", genTime: inspectTimeStampResponse(bytes).genTime };
  }
  const text = await loadSealText(provider, snapshotId);
  if (text === null) return { status: "pending", message: "封印ファイルが見つかりません" };

  const key = keyFor(meta, "rfc3161");
  const nowIso = () => (opts.now?.() ?? new Date()).toISOString();
  const markPending = async (message: string): Promise<AttachResult> => {
    await updateSnapshotMeta(provider, noteId, snapshotId, (m) =>
      m.seal
        ? {
          ...m,
          seal: {
            ...m.seal,
            receipts: upsertReceipt(m.seal.receipts, {
              kind: "rfc3161",
              endpoint: tsa.url,
              status: "pending",
              receiptKey: key,
              updatedAt: nowIso(),
              failures: failuresOf(m.seal.receipts, key) + 1,
            }),
          },
        }
        : null,
    );
    return { status: "pending", message };
  };

  let res: { status: number; json: unknown };
  try {
    res = await (opts.post ?? defaultPost)(`${apiBase()}/seal/rfc3161`, {
      hash: meta.seal.sealHash,
      tsa: tsa.id,
    });
  } catch (e) {
    return markPending(e instanceof Error ? e.message : String(e));
  }
  // ルートが無い（Web 版の静的配信など）なら、この環境では付けられない
  if (res.status === 404 || res.status === 405) return { status: "unsupported" };
  const body = res.json as { tsr?: unknown; message?: unknown } | null;
  if (res.status !== 200 || typeof body?.tsr !== "string") {
    return markPending(typeof body?.message === "string" ? body.message : `HTTP ${res.status}`);
  }

  const tsr = base64ToBytes(body.tsr);
  const verified = await verifyTimeStampResponse(tsr, new TextEncoder().encode(text), [tsa.rootPem]);
  if (!verified.ok || !verified.genTime) {
    // 検証できない受領書は保存しない
    return markPending(verified.message ?? "受領書を検証できませんでした");
  }
  await provider.writeAppData(key, body.tsr);
  await updateSnapshotMeta(provider, noteId, snapshotId, (m) =>
    m.seal
      ? {
        ...m,
        seal: {
          ...m.seal,
          receipts: upsertReceipt(m.seal.receipts, {
            kind: "rfc3161",
            endpoint: tsa.url,
            status: "confirmed",
            receiptKey: key,
            updatedAt: nowIso(),
          }),
        },
      }
      : null,
  );
  return { status: "confirmed", genTime: verified.genTime };
}

export interface ReceiptCheck {
  kind: SealReceipt["kind"];
  endpoint: string;
  status: SealReceipt["status"];
  /** 署名まで確かめられたか（pending は null） */
  ok: boolean | null;
  /** 証明された時刻（受領書から読む） */
  provenAt: Date | null;
  message?: string;
}

/** 封印に付いている受領書を、保存済みの封印ファイルの全文で検証し直す */
export async function checkReceipts(
  provider: StorageProvider,
  meta: SnapshotMeta,
  getHeader: (height: number) => Promise<string> = makeHeaderFetcher(),
): Promise<ReceiptCheck[]> {
  const out: ReceiptCheck[] = [];
  if (!meta.seal) return out;
  const text = await loadSealText(provider, meta.id);
  const data = text === null ? null : new TextEncoder().encode(text);
  for (const r of meta.seal.receipts) {
    if (r.status !== "confirmed" && (r.kind === "rfc3161" || r.status === "failed")) {
      out.push({ kind: r.kind, endpoint: r.endpoint, status: r.status, ok: null, provenAt: null });
      continue;
    }
    const bytes = await loadReceiptBytes(provider, r.receiptKey);
    if (!bytes || !data) {
      out.push({
        kind: r.kind,
        endpoint: r.endpoint,
        status: r.status,
        ok: false,
        provenAt: null,
        message: !bytes ? "受領書が見つかりません" : "封印ファイルが見つかりません",
      });
      continue;
    }
    if (r.kind === "rfc3161") {
      const tsa = TSA_REGISTRY.find((t) => t.url === r.endpoint);
      const v = await verifyTimeStampResponse(bytes, data, tsa ? [tsa.rootPem] : []);
      out.push({
        kind: r.kind,
        endpoint: r.endpoint,
        status: r.status,
        ok: v.ok,
        provenAt: v.genTime,
        ...(v.message ? { message: v.message } : {}),
      });
    } else {
      try {
        const v = await verifyOts(bytes, meta.seal.sealHash, getHeader);
        out.push({
          kind: r.kind,
          endpoint: r.endpoint,
          status: r.status,
          ok: !v.fileHashMatches ? false : v.ok ? true : null,
          provenAt: v.earliestTime ? new Date(v.earliestTime * 1000) : null,
          ...(!v.fileHashMatches ? { message: "証明の対象が固定したファイルと違います" } : {}),
        });
      } catch (e) {
        out.push({
          kind: r.kind,
          endpoint: r.endpoint,
          status: r.status,
          ok: false,
          provenAt: null,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }
  return out;
}

// ── OpenTimestamps ──

export const OTS_ENDPOINT = "opentimestamps";

/** 既知のカレンダーの Pending だけを、重複除き・カレンダー単位の巡回で最大 limit 件選ぶ */
export function pickPendingRoundRobin<T extends { uri: string; commitment: string }>(
  all: T[],
  limit: number,
): T[] {
  const byUri = new Map<string, T[]>();
  const seen = new Set<string>();
  for (const p of all) {
    if (!isKnownCalendar(p.uri)) continue;
    const k = `${p.uri}\n${p.commitment}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const list = byUri.get(p.uri);
    if (list) list.push(p);
    else byUri.set(p.uri, [p]);
  }
  const queues = [...byUri.values()];
  const out: T[] = [];
  for (let i = 0; out.length < limit; i++) {
    let any = false;
    for (const q of queues) {
      if (i < q.length) {
        any = true;
        out.push(q[i]);
        if (out.length >= limit) break;
      }
    }
    if (!any) break;
  }
  return out;
}

/** 1 回の upgrade で問い合わせる Pending の数の上限 */
const MAX_UPGRADES_PER_CALL = 16;

async function setReceipt(
  provider: StorageProvider,
  noteId: string,
  snapshotId: string,
  receipt: SealReceipt,
): Promise<void> {
  await updateSnapshotMeta(provider, noteId, snapshotId, (m) =>
    m.seal ? { ...m, seal: { ...m.seal, receipts: upsertReceipt(m.seal.receipts, receipt) } } : null,
  );
}

/**
 * 封印を OpenTimestamps のカレンダーに出す。応答から .ots を作って保存し、pending にする。
 * 確定（Bitcoin への記録）は数時間後なので、upgradeOts で取りに行く。
 */
export async function attachOts(
  provider: StorageProvider,
  noteId: string,
  snapshotId: string,
  opts: { post?: PostJson; now?: () => Date; nonce?: Uint8Array } = {},
): Promise<AttachResult> {
  if (!provider.writeAppData) return { status: "unsupported" };
  const meta = (await listSnapshots(provider, noteId)).find((m) => m.id === snapshotId);
  if (!meta?.seal) return { status: "not_sealed" };
  const existing = meta.seal.receipts.find((r) => r.kind === "opentimestamps");
  if (existing && existing.status !== "failed" && (await loadReceiptBytes(provider, existing.receiptKey))) {
    // 出し済み。確定は upgradeOts で取りに行く
    return existing.status === "confirmed" ? { status: "confirmed" } : { status: "pending", message: "確定待ち" };
  }
  const key = existing?.receiptKey ?? keyFor(meta, "opentimestamps");
  const nowIso = () => (opts.now?.() ?? new Date()).toISOString();
  // 封印ファイルのハッシュそのものは出さず、乱数で隠したものを出す
  const { blinded, nonce } = await blindDigest(hexToBytes(meta.seal.sealHash), opts.nonce);
  let res: { status: number; json: unknown };
  try {
    res = await (opts.post ?? defaultPost)(`${apiBase()}/seal/ots/submit`, { hash: bytesToHex(blinded) });
  } catch (e) {
    await setReceipt(provider, noteId, snapshotId, {
      kind: "opentimestamps", endpoint: OTS_ENDPOINT, status: "failed", receiptKey: key, updatedAt: nowIso(),
      failures: (existing?.failures ?? 0) + 1,
    });
    return { status: "pending", message: e instanceof Error ? e.message : String(e) };
  }
  if (res.status === 404 || res.status === 405) return { status: "unsupported" };
  const responses = (res.json as { responses?: { calendar: string; body: string }[] } | null)?.responses;
  if (res.status !== 200 || !Array.isArray(responses) || responses.length === 0) {
    // 出せなかった。受領書の本体が無いので "failed"（次に開いたときに出し直す）
    await setReceipt(provider, noteId, snapshotId, {
      kind: "opentimestamps", endpoint: OTS_ENDPOINT, status: "failed", receiptKey: key, updatedAt: nowIso(),
      failures: (existing?.failures ?? 0) + 1,
    });
    return { status: "pending", message: `HTTP ${res.status}` };
  }
  const known = responses.filter((r) => isKnownCalendar(r.calendar));
  if (known.length === 0) return { status: "pending", message: "登録簿にないカレンダーの応答でした" };
  const digest = hexToBytes(meta.seal.sealHash);
  // 1 件の不正な応答（OTS でない中身・多すぎる attestation）でほかの正常な応答まで捨てない。
  // 先頭から足していき、合流後の .ots を読み戻せるものだけ使う（attestation の数の上限は
  // 木全体にかかるので、1 件ずつ読めても合流すると超えることがある）
  const bodies: Uint8Array[] = [];
  let ots: Uint8Array | null = null;
  for (const r of known) {
    try {
      const body = base64ToBytes(r.body);
      if (countAttestations(parseTimestampBody(body)) > MAX_ATTESTATIONS_PER_RESPONSE) continue;
      const candidate = buildBlindedOts(digest, nonce, [...bodies, body]);
      parseOts(candidate);
      bodies.push(body);
      ots = candidate;
    } catch {
      // このカレンダーの応答は使わない
    }
  }
  if (!ots) {
    await setReceipt(provider, noteId, snapshotId, {
      kind: "opentimestamps", endpoint: OTS_ENDPOINT, status: "failed", receiptKey: key, updatedAt: nowIso(),
      failures: (existing?.failures ?? 0) + 1,
    });
    return { status: "pending", message: "カレンダーの応答を読めませんでした" };
  }
  await provider.writeAppData(key, bytesToBase64(ots));
  await setReceipt(provider, noteId, snapshotId, {
    kind: "opentimestamps", endpoint: OTS_ENDPOINT, status: "pending", receiptKey: key, updatedAt: nowIso(),
  });
  return { status: "pending", message: "確定待ち" };
}

/**
 * OpenTimestamps の確定を取りに行く。Bitcoin の記録が付き、ブロックヘッダと照合できたら confirmed。
 * まだなら pending のまま（通知は出さない）。
 */
export async function upgradeOts(
  provider: StorageProvider,
  noteId: string,
  snapshotId: string,
  opts: { post?: PostJson; getHeader?: (height: number) => Promise<string>; now?: () => Date } = {},
): Promise<AttachResult> {
  if (!provider.writeAppData) return { status: "unsupported" };
  const meta = (await listSnapshots(provider, noteId)).find((m) => m.id === snapshotId);
  const receipt = meta?.seal?.receipts.find((r) => r.kind === "opentimestamps");
  if (!meta?.seal || !receipt) return { status: "not_sealed" };
  const bytes = await loadReceiptBytes(provider, receipt.receiptKey);
  if (!bytes) return { status: "pending", message: "証明がまだありません" };
  let file: OtsFile;
  try {
    file = parseOts(bytes);
  } catch {
    return { status: "pending", message: "証明を読めませんでした" };
  }
  let merged = 0;
  // .ots の中の URI はそのまま信用せず、登録簿にあるものだけを対象にする。
  // 乗っ取られたカレンダーが偽の Pending を大量に並べても、ほかのカレンダーの枠が
  // 押し出されないよう、(URI, commitment) の重複を除き、カレンダーごとに順番に枠を配る
  const pendings = pickPendingRoundRobin(await listPending(file), MAX_UPGRADES_PER_CALL);
  for (const p of pendings) {
    try {
      const res = await (opts.post ?? defaultPost)(`${apiBase()}/seal/ots/upgrade`, {
        calendar: p.uri,
        commitment: p.commitment,
      });
      const body = res.json as { status?: string; body?: string } | null;
      if (res.status === 404 || res.status === 405) return { status: "unsupported" };
      if (res.status === 200 && body?.status === "upgraded" && typeof body.body === "string") {
        // 応答を 1 件ずつ合流させ、そのたびに上限内で読み戻せるかを確かめる。
        // だめな応答（attestation が多すぎる・合流すると木の上限を超える）だけ飛ばして元に戻す
        const upgrade = base64ToBytes(body.body);
        if (countAttestations(parseTimestampBody(upgrade)) > MAX_ATTESTATIONS_PER_RESPONSE) continue;
        const backup = serializeOts(file);
        try {
          const n = await applyUpgrade(file, p.commitment, upgrade, p.uri);
          parseOts(serializeOts(file));
          merged += n;
        } catch {
          file = parseOts(backup);
        }
      }
    } catch {
      // 届かなければ次の機会に
    }
  }
  let updated = bytes;
  if (merged > 0) {
    // 乗っ取られたカレンダーの応答で木が膨らんでも、読み戻せない .ots を書かない
    // （書くと次回から parseOts が上限超えで弾き、元の証明にも戻れなくなる）
    try {
      const next = serializeOts(file);
      parseOts(next);
      await provider.writeAppData(receipt.receiptKey, bytesToBase64(next));
      updated = next;
    } catch {
      return { status: "pending", message: "確定待ち" };
    }
  }
  if ((await listBitcoinClaims(file)).length === 0) return { status: "pending", message: "確定待ち" };
  const v = await verifyOts(updated, meta.seal.sealHash, opts.getHeader ?? makeHeaderFetcher());
  if (!v.ok || !v.earliestTime) return { status: "pending", message: "照合できませんでした" };
  await setReceipt(provider, noteId, snapshotId, {
    ...receipt,
    status: "confirmed",
    updatedAt: (opts.now?.() ?? new Date()).toISOString(),
  });
  return { status: "confirmed", genTime: new Date(v.earliestTime * 1000) };
}
