// 封印ファイル（seal-manifest.json）の組み立てと、素材の列挙・ハッシュ。
//
// ここは純粋に近い関数だけを置く（保存は seal-store.ts）。
// 封印ファイルは「1 回だけ文字列にして、その文字列を正本にする」のが要。

import type { GraphiumDocument } from "../../lib/document-types";
import {
  collectChartAssetFileIdsFromBlocks,
  collectDataTableAssetFileIdsFromBlocks,
  collectInlineImageFileIdsFromBlocks,
  collectMeetingTranscriptFileIdsFromBlocks,
  collectSourceAssetFileIdsFromDoc,
} from "../asset-browser/media-index";
import {
  SEAL_FORMAT,
  type SealAuthor,
  type SealManifest,
  type SealMediaEntry,
} from "./types";

/** 封印で中身のハッシュを取る素材 1 ファイルの上限（超えたらハッシュだけを諦めて理由を残す） */
export const SEAL_MEDIA_MAX_BYTES = 50 * 1024 * 1024;

/** ブロックの props.url を素材を持つものとして扱う種類 */
const URL_MEDIA_BLOCK_TYPES = new Set(["image", "video", "audio", "file", "pdf"]);

/** 文字列の UTF-8 バイト列の SHA-256（hex） */
export async function sha256HexOfText(text: string): Promise<string> {
  return sha256HexOfBytes(new TextEncoder().encode(text));
}

/** バイト列の SHA-256（hex） */
export async function sha256HexOfBytes(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 版の doc が参照している素材の fileId → 参照ブロック ID の対応を集める。
 *
 * 2 系統を合わせる（snapshot-refs.ts / media-index の usedIn と同じ考え方）:
 * - ブロック: 素材ブロックの props.url（extractFileId で fileId に直す）と props.fileId、
 *   インライン画像・データ表・会議の書き起こし・チャートの素材
 * - doc 直下: sourcePdfFileId / sourceDocumentFileId / sourceTextFileId / citedAssetFileIds /
 *   tableMeta.source.fileId
 * URL だけの参照（"url:" で始まる ID・ブックマーク・外部 URL）は対象外。中身を持たないため。
 */
export function collectSealMediaRefs(
  doc: GraphiumDocument,
  extractFileId: (url: string) => string | null,
): Map<string, Set<string>> {
  const refs = new Map<string, Set<string>>();
  const add = (fileId: string | null | undefined, blockId?: string) => {
    if (!fileId || fileId.startsWith("url:")) return;
    let set = refs.get(fileId);
    if (!set) {
      set = new Set();
      refs.set(fileId, set);
    }
    if (blockId) set.add(blockId);
  };

  const walk = (blocks: any[]) => {
    for (const block of blocks ?? []) {
      if (!block || typeof block !== "object") continue;
      const props = block.props ?? {};
      if (URL_MEDIA_BLOCK_TYPES.has(block.type) && typeof props.url === "string" && props.url) {
        add(extractFileId(props.url), block.id);
      }
      if (typeof props.fileId === "string") add(props.fileId, block.id);
      // ブロック単位の専用収集（ブロック ID まで分かるよう 1 ブロックずつ渡す）
      for (const collect of [
        collectInlineImageFileIdsFromBlocks,
        collectDataTableAssetFileIdsFromBlocks,
        collectMeetingTranscriptFileIdsFromBlocks,
        collectChartAssetFileIdsFromBlocks,
      ]) {
        for (const id of collect([{ ...block, children: [] }])) add(id, block.id);
      }
      if (Array.isArray(block.children) && block.children.length) walk(block.children);
    }
  };
  for (const page of doc.pages ?? []) walk(page.blocks ?? []);

  for (const id of collectSourceAssetFileIdsFromDoc(doc as any)) add(id);
  return refs;
}

/** ブロックに書かれた素材の名前（素材インデックスに無いときの補い） */
export function collectBlockMediaNames(
  doc: GraphiumDocument,
  extractFileId: (url: string) => string | null,
): Map<string, string> {
  const names = new Map<string, string>();
  const walk = (blocks: any[]) => {
    for (const block of blocks ?? []) {
      const props = block?.props ?? {};
      if (typeof props.name === "string" && props.name) {
        const id =
          (URL_MEDIA_BLOCK_TYPES.has(block.type) && typeof props.url === "string" && extractFileId(props.url)) ||
          (typeof props.fileId === "string" ? props.fileId : null);
        if (id && !names.has(id)) names.set(id, props.name);
      }
      if (Array.isArray(block?.children)) walk(block.children);
    }
  };
  for (const page of doc.pages ?? []) walk(page.blocks ?? []);
  return names;
}

/** 素材のバイト列を読む関数（プロバイダの readMediaBytes / loadMediaText を包んだもの） */
export type ReadMediaForSeal = (
  fileId: string,
  maxBytes: number,
) => Promise<{ bytes: Uint8Array } | { tooLarge: true } | null>;

/** 素材 1 件の表示用の情報（素材インデックスから引く） */
export type MediaInfoLookup = (fileId: string) => { name?: string; mimeType?: string } | undefined;

/** 参照の一覧から、封印ファイルに入れる素材の行を作る（中身のハッシュは毎回バイト列から計算） */
export async function hashSealMedia(
  refs: Map<string, Set<string>>,
  read: ReadMediaForSeal,
  lookup: MediaInfoLookup,
  maxBytes = SEAL_MEDIA_MAX_BYTES,
): Promise<SealMediaEntry[]> {
  const entries: SealMediaEntry[] = [];
  // 並び順を固定する（同じ版を封印し直しても同じ並びになるよう、fileId 昇順）
  const ids = [...refs.keys()].sort();
  for (const fileId of ids) {
    const info = lookup(fileId);
    const base: SealMediaEntry = {
      fileId,
      blockIds: [...(refs.get(fileId) ?? [])].sort(),
      ...(info?.name ? { name: info.name } : {}),
      ...(info?.mimeType ? { mimeType: info.mimeType } : {}),
    };
    let res: Awaited<ReturnType<ReadMediaForSeal>> = null;
    try {
      res = await read(fileId, maxBytes);
    } catch {
      res = null;
    }
    if (res && "bytes" in res) {
      entries.push({
        ...base,
        size: res.bytes.byteLength,
        sha256: `sha256:${await sha256HexOfBytes(res.bytes)}`,
      });
    } else {
      entries.push({ ...base, unhashedReason: res && "tooLarge" in res ? "too_large" : "unreadable" });
    }
  }
  return entries;
}

export interface BuildSealManifestInput {
  noteId: string;
  snapshotId: string;
  version: number;
  label?: string;
  snapshotSavedAt: string;
  sealedAt: string;
  sealIndex: number;
  prevSealHash: string | null;
  author: SealAuthor | null;
  document: GraphiumDocument;
  media: SealMediaEntry[];
}

/**
 * 封印ファイルの文字列と、そのハッシュを作る。
 * キーの並びはここで固定する（オブジェクトリテラルの順 = JSON.stringify の順）。
 */
export async function buildSealManifest(
  input: BuildSealManifestInput,
): Promise<{ text: string; sealHash: string; manifest: SealManifest }> {
  const manifest: SealManifest = {
    format: SEAL_FORMAT,
    noteId: input.noteId,
    snapshotId: input.snapshotId,
    title: input.document.title ?? "",
    version: input.version,
    ...(input.label ? { label: input.label } : {}),
    snapshotSavedAt: input.snapshotSavedAt,
    sealedAt: input.sealedAt,
    sealIndex: input.sealIndex,
    prevSealHash: input.prevSealHash,
    author: input.author,
    document: input.document,
    media: input.media,
  };
  const text = JSON.stringify(manifest);
  return { text, sealHash: await sha256HexOfText(text), manifest };
}

/** 保存済みの封印ファイルの文字列を読む（形式が違えば null） */
export function parseSealManifest(text: string): SealManifest | null {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && v.format === SEAL_FORMAT ? (v as SealManifest) : null;
  } catch {
    return null;
  }
}
