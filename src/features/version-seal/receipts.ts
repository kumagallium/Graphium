// 封印への時刻証明（受領書）の取り付けと検証。画面側で動く。
//
// RFC 3161: sidecar（/api/seal/rfc3161）に封印ファイルのハッシュだけを渡し、返ってきた応答を
// 封印ファイルの全文と同梱のルート証明書で検証してから保存する。通らなければ保存しない。
// 失敗（オフライン・局の停止）は "pending" として残し、あとで付け直す。封印そのものは成立させる。

import type { StorageProvider } from "../../lib/storage/types";
import { apiBase } from "../../lib/platform";
import { listSnapshots, updateSnapshotMeta } from "../version-snapshots/snapshot-store";
import type { SnapshotMeta } from "../version-snapshots/types";
import { base64ToBytes, inspectTimeStampResponse, verifyTimeStampResponse } from "./rfc3161";
import { loadSealText, receiptKey } from "./seal-store";
import { DEFAULT_TSA_ID, findTsa, TSA_REGISTRY } from "./tsa-registry";
import type { SealReceipt } from "./types";

export type AttachResult =
  | { status: "confirmed"; genTime: Date }
  | { status: "pending"; message: string }
  /** この環境（sidecar の無い Web 版など）では送れない */
  | { status: "unsupported" }
  | { status: "not_sealed" };

type PostJson = (url: string, body: unknown) => Promise<{ status: number; json: unknown }>;

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
): Promise<ReceiptCheck[]> {
  const out: ReceiptCheck[] = [];
  if (!meta.seal) return out;
  const text = await loadSealText(provider, meta.id);
  const data = text === null ? null : new TextEncoder().encode(text);
  for (const r of meta.seal.receipts) {
    if (r.status !== "confirmed") {
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
      // OpenTimestamps の検証は opentimestamps.ts（後続）で足す
      out.push({ kind: r.kind, endpoint: r.endpoint, status: r.status, ok: null, provenAt: null });
    }
  }
  return out;
}
