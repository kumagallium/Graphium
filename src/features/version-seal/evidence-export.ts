// 固定した時点の証拠 zip の組み立て。
//
// 中身（設計メモ §3.4）:
//   seal-manifest.json      封印ファイル（時刻証明の対象そのもの。保存した文字列をそのまま書く）
//   media/<sha256>.<ext>    素材（同名の別ファイルがあり得るのでハッシュ名。今の中身が固定時と同じものだけ）
//   rfc3161/<n>.tsr         RFC 3161 の受領書
//   rfc3161/<n>-ca.pem      その局のルート証明書（同梱して固定しているもの）
//   ots/<n>.ots             OpenTimestamps の証明
//   VERIFY.md               Graphium を使わずに確かめる手順（英語）
// zip はアプリ内に控えを残さない。利用者が選んだ場所に書き出すだけ。

import { strToU8, zipSync, type Zippable } from "fflate";
import type { StorageProvider } from "../../lib/storage/types";
import { listSnapshots } from "../version-snapshots/snapshot-store";
import { parseSealManifest, sha256HexOfBytes } from "./manifest";
import { loadReceiptBytes } from "./receipts";
import { loadSealText, makeMediaReader } from "./seal-store";
import { TSA_REGISTRY } from "./tsa-registry";
import type { ReadMediaForSeal } from "./manifest";
import type { SealManifest } from "./types";

export interface EvidenceFiles {
  files: Record<string, Uint8Array>;
  /** zip にする前の合計バイト数（書き出す前に見せる） */
  totalBytes: number;
  /** 固定したときと中身が変わった・読めない素材（zip に入れなかったもの） */
  omittedMedia: { fileId: string; name?: string; reason: "changed" | "missing" | "not_hashed" }[];
  manifest: SealManifest;
}

function extOf(name: string | undefined, mimeType: string | undefined): string {
  const m = name?.match(/\.([A-Za-z0-9]{1,8})$/);
  if (m) return m[1].toLowerCase();
  const sub = mimeType?.split("/")[1]?.split(/[+;]/)[0];
  return sub && /^[a-z0-9]{1,8}$/.test(sub) ? sub : "bin";
}

/** zip に入れるファイルを集める（zip にはしない。テストしやすくするため） */
export async function collectEvidenceFiles(
  provider: StorageProvider,
  noteId: string,
  snapshotId: string,
  readMedia: ReadMediaForSeal = makeMediaReader(provider),
): Promise<EvidenceFiles | null> {
  const meta = (await listSnapshots(provider, noteId)).find((m) => m.id === snapshotId);
  if (!meta?.seal) return null;
  const text = await loadSealText(provider, snapshotId);
  const manifest = text === null ? null : parseSealManifest(text);
  if (text === null || !manifest) return null;

  const files: Record<string, Uint8Array> = {};
  files["seal-manifest.json"] = strToU8(text);
  const omittedMedia: EvidenceFiles["omittedMedia"] = [];

  for (const m of manifest.media) {
    if (!m.sha256) {
      omittedMedia.push({ fileId: m.fileId, name: m.name, reason: "not_hashed" });
      continue;
    }
    let res: Awaited<ReturnType<ReadMediaForSeal>> = null;
    try {
      res = await readMedia(m.fileId, Number.MAX_SAFE_INTEGER);
    } catch {
      res = null;
    }
    if (!res || !("bytes" in res)) {
      omittedMedia.push({ fileId: m.fileId, name: m.name, reason: "missing" });
      continue;
    }
    const hex = await sha256HexOfBytes(res.bytes);
    if (`sha256:${hex}` !== m.sha256) {
      omittedMedia.push({ fileId: m.fileId, name: m.name, reason: "changed" });
      continue;
    }
    files[`media/${hex}.${extOf(m.name, m.mimeType)}`] = res.bytes;
  }

  let rfcN = 0;
  let otsN = 0;
  const receiptLines: string[] = [];
  for (const r of meta.seal.receipts) {
    if (r.status !== "confirmed" && r.kind === "rfc3161") continue;
    const bytes = await loadReceiptBytes(provider, r.receiptKey);
    if (!bytes) continue;
    if (r.kind === "rfc3161") {
      rfcN += 1;
      files[`rfc3161/${rfcN}.tsr`] = bytes;
      const tsa = TSA_REGISTRY.find((t) => t.url === r.endpoint);
      if (tsa) files[`rfc3161/${rfcN}-ca.pem`] = strToU8(tsa.rootPem);
      receiptLines.push(`rfc3161/${rfcN}.tsr (${tsa?.name ?? r.endpoint})`);
    } else {
      otsN += 1;
      files[`ots/${otsN}.ots`] = bytes;
      receiptLines.push(`ots/${otsN}.ots (OpenTimestamps${r.status === "confirmed" ? "" : ", pending at export time"})`);
    }
  }

  files["VERIFY.md"] = strToU8(buildVerifyMd(manifest, meta.seal.sealHash, rfcN, otsN, omittedMedia.length));
  const totalBytes = Object.values(files).reduce((n, b) => n + b.byteLength, 0);
  return { files, totalBytes, omittedMedia, manifest };
}

/** 素材の合計サイズだけを先に見積もる（書き出す前に見せる） */
export function estimateEvidenceBytes(manifest: SealManifest, manifestTextBytes: number): number {
  return manifest.media.reduce((n, m) => n + (m.sha256 ? m.size ?? 0 : 0), manifestTextBytes);
}

/** zip のバイト列と、書き出し時の名前を作る */
export function zipEvidence(ev: EvidenceFiles): { bytes: Uint8Array; filename: string } {
  const zippable: Zippable = {};
  for (const [path, bytes] of Object.entries(ev.files)) zippable[path] = bytes;
  const bytes = zipSync(zippable, { level: 6 });
  const safeTitle = (ev.manifest.title || "note").replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 60);
  const date = ev.manifest.sealedAt.slice(0, 10);
  return { bytes, filename: `graphium-seal-${safeTitle}-${ev.manifest.sealIndex}-${date}.zip` };
}

function buildVerifyMd(
  manifest: SealManifest,
  sealHash: string,
  rfcCount: number,
  otsCount: number,
  omitted: number,
): string {
  const lines = [
    "# How to verify this Graphium seal",
    "",
    "This archive was exported from Graphium. It lets anyone check, without Graphium,",
    "that `seal-manifest.json` existed before the time shown in the timestamp receipts",
    "and has not been changed since.",
    "",
    "What this proves: the exact bytes of `seal-manifest.json` existed before the",
    "timestamp. What it does not prove: who wrote the content, or that nothing else",
    "was ever written. Files on a personal computer can be deleted by their owner.",
    "",
    "## 1. The hash of the seal file",
    "",
    "```sh",
    "shasum -a 256 seal-manifest.json",
    "```",
    "",
    `Expected: \`${sealHash}\``,
    "",
    "Use the file exactly as it is. Re-formatting the JSON changes the hash.",
    "",
  ];
  if (rfcCount > 0) {
    lines.push(
      "## 2. RFC 3161 timestamps",
      "",
      "```sh",
      ...Array.from({ length: rfcCount }, (_, i) =>
        `openssl ts -verify -data seal-manifest.json -in rfc3161/${i + 1}.tsr -CAfile rfc3161/${i + 1}-ca.pem`,
      ),
      "# show the time: openssl ts -reply -in rfc3161/1.tsr -text",
      "```",
      "",
      "`Verification: OK` means the receipt matches this file. If the TSA certificate has",
      "expired by the time you check, add `-attime <unix time of the receipt>`.",
      "The root certificate is the one published by the TSA itself.",
      "",
    );
  }
  if (otsCount > 0) {
    lines.push(
      "## 3. OpenTimestamps",
      "",
      "Drop `seal-manifest.json` and the `.ots` file on https://opentimestamps.org, or run",
      "`ots verify -f seal-manifest.json ots/1.ots` with the OpenTimestamps client.",
      "A pending proof can be completed later with `ots upgrade ots/1.ots`.",
      "",
    );
  }
  lines.push(
    "## 4. Media files",
    "",
    "Each entry in `media` inside `seal-manifest.json` has a `sha256`. The files in",
    "`media/` are named by that hash, so `shasum -a 256 media/*` should match the names.",
    omitted > 0
      ? `${omitted} media file(s) are listed in the seal but not included here (too large, or changed or missing at export time).`
      : "",
    "",
    "## 5. Earlier seals",
    "",
    `This is seal number ${manifest.sealIndex} of this note. \`prevSealHash\` is the hash of`,
    "the previous seal file. Showing the later seal proves that the earlier one existed",
    "unchanged; a missing earlier seal shows up as a gap.",
    "",
  );
  return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
}
