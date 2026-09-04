// 共有ノートの中にある画像・ファイル（SharedEntry.extra.blobs）を、
// 素材タブの「行」に組み立てる純関数群（PR 2b / spec §19 B）。
//
// なぜ別モジュールにするか:
// - blob は SharedEntry ではない（引用リンク・fork・検証を持たない仮想行）ので、
//   表の描画から切り離して「行の作り方」だけを単体テストできるようにする
// - 同じ画像が複数ノートに貼られていても、利用者から見れば素材は 1 つ。
//   hash（content-addressed）で 1 行に畳む判断をここに閉じ込める
//
// 触らないもの: 共有フォーマット（BlobRef の構造）は読むだけ。新しい読み取りも足さない
// （extra.blobs は共有ストアのスナップショットに既に載っている）。

import type { BlobRef, SharedEntry } from "../../lib/storage/shared";
import { mimeToMediaType, type MediaType } from "../asset-browser/media-index";
import { mimeFromExtension } from "../mobile-capture/inbox/mime";

/** 素材タブの 1 行にまとめた blob（同じ hash のものは 1 つに畳んである）。 */
export type SharedBlobRow = {
  /** 行の識別子（表の key / 取り込み中の判定に使う） */
  key: string;
  /** 代表の BlobRef（bytes 取得・題名の元） */
  blob: BlobRef;
  /** 代表の親ノート。作者・共有日・フォルダ・操作（開く / 取り込む）の起点 */
  parent: SharedEntry;
  /** 同じ hash を持つ共有ノート全部（出どころ列の「N 件のノート」） */
  parents: SharedEntry[];
};

/**
 * 素材タブに並ぶ行。既存タブ（ノート / ナレッジ / 素材の共有エントリ）は
 * すべて kind: "entry"、共有ノート内の画像・ファイルだけが kind: "blob"。
 */
export type SharedAssetItem =
  | { kind: "entry"; entry: SharedEntry }
  | ({ kind: "blob" } & SharedBlobRow);

/**
 * mimeFromExtension（モバイル捕獲の表）はカメラ・ボイスメモ由来の拡張子しか持たない。
 * 共有ノートには論文や実験の Office 文書も貼られるので、ここだけ拡張子→MIME を補う。
 * MIME → 種別の判定そのものは mimeToMediaType に委ねる（分類の真実は 1 つに保つ）。
 */
const OFFICE_EXT_TO_MIME: Record<string, string> = {
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

function officeMimeFromExtension(filename: string): string | null {
  const dot = filename.lastIndexOf(".");
  if (dot < 0 || dot === filename.length - 1) return null;
  return OFFICE_EXT_TO_MIME[filename.slice(dot + 1).toLowerCase()] ?? null;
}

/** SharedEntry.extra.blobs を型安全に読む（壊れた extra でも落ちないようにする）。 */
export function readEntryBlobs(entry: SharedEntry): BlobRef[] {
  const blobs = (entry.extra as Record<string, unknown> | undefined)?.blobs;
  if (!Array.isArray(blobs)) return [];
  return blobs.filter(
    (b): b is BlobRef =>
      !!b && typeof b === "object" && typeof (b as BlobRef).hash === "string" && !!(b as BlobRef).hash,
  );
}

/**
 * hash の表示用の短縮形。`sha256:...` のようなアルゴリズム接頭辞は情報量が無いので落とす。
 * 題名が無い blob（filename を持たない古い共有）の代わりに出す。
 */
export function shortBlobHash(hash: string): string {
  const colon = hash.indexOf(":");
  const body = colon >= 0 ? hash.slice(colon + 1) : hash;
  return body.slice(0, 12);
}

/** 行の題名。filename があればそれ、無ければ hash の先頭 12 桁。 */
export function blobRowTitle(row: { blob: BlobRef }): string {
  const filename = typeof row.blob.filename === "string" ? row.blob.filename.trim() : "";
  return filename || shortBlobHash(row.blob.hash);
}

/**
 * blob の種別（asset.type.* のキーになる）。
 * BlobRef は mime を持たないので拡張子から推定し、分からなければ "other"。
 */
export function blobMediaType(blob: BlobRef): MediaType {
  const filename = typeof blob.filename === "string" ? blob.filename : "";
  // BlobRef 型に mime は無いが、将来 provider が付けてきた場合は宣言値を優先する
  // （共有フォーマットは変えないので、あくまで「あれば読む」に留める）
  const declared = (blob as { mime?: unknown }).mime;
  const mime =
    (typeof declared === "string" && declared ? declared : null) ??
    mimeFromExtension(filename) ??
    officeMimeFromExtension(filename) ??
    "";
  return mimeToMediaType(mime, filename || undefined);
}

/** 種別列に出す i18n キー。 */
export function blobKindLabelKey(blob: BlobRef): string {
  return `asset.type.${blobMediaType(blob)}`;
}

/**
 * 共有ノート（extra.blobs を持つもの）から素材タブの blob 行を組み立てる。
 *
 * - 同じ hash は 1 行に畳む（content-addressed = 中身が同じなら同じ素材）
 * - 代表の BlobRef は「題名を持つ最初のもの」を選ぶ（片方だけ filename を
 *   持つ共有でも題名が出るようにする）
 * - 親ノートの順は渡された順（呼び出し側で updated_at 降順に並べてある）
 */
export function buildSharedBlobRows(parents: SharedEntry[]): SharedBlobRow[] {
  const byHash = new Map<string, SharedBlobRow>();
  for (const parent of parents) {
    // 同じノートが同じ hash を 2 回持っていても親を二重に数えない
    const seenInParent = new Set<string>();
    for (const blob of readEntryBlobs(parent)) {
      if (seenInParent.has(blob.hash)) continue;
      seenInParent.add(blob.hash);
      const existing = byHash.get(blob.hash);
      if (!existing) {
        byHash.set(blob.hash, {
          key: `blob:${blob.hash}`,
          blob,
          parent,
          parents: [parent],
        });
        continue;
      }
      existing.parents.push(parent);
      // 代表がまだ題名を持っていなければ、題名を持つ方に差し替える
      if (!existing.blob.filename && blob.filename) existing.blob = blob;
    }
  }
  return [...byHash.values()];
}
