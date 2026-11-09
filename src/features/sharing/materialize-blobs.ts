// Fork 時の `shared-blob:` URL materialize（Phase 2c-2）。
//
// 設計判断（docs/internal/team-shared-storage-design.md §12 Phase 2c）:
// - Fork 後のローカルノートは blob root の可用性に依存させない（PKM 原則）
// - shared 側から bytes を取得して、自分の MediaProvider に再 upload する
// - 元の BlobRef は extra.blobs に残っているので hash 引きで対応 BlobRef を取れる
// - mime type は BlobRef に保存されていないため、マジックバイトで sniff する
//   （legacy 共有データも扱えるよう、保存時の mime キャッシュには依存しない）

import type { GraphiumDocument } from "../../lib/document-types";
import type { BlobRef } from "../../lib/storage/shared";
import { parseSharedBlobUrl } from "./auto-blob";

const MEDIA_TYPES = new Set(["image", "video", "audio", "file", "pdf"]);

/**
 * doc を走査して `shared-blob:<hash>` 形式の url を持つブロックの hash を集める。
 * 同じ hash は dedup。
 */
export function collectSharedBlobHashes(doc: GraphiumDocument): string[] {
  const seen = new Set<string>();
  const walk = (blocks: any[] | undefined): void => {
    if (!blocks) return;
    for (const b of blocks) {
      if (MEDIA_TYPES.has(b?.type) && typeof b?.props?.url === "string") {
        const hash = parseSharedBlobUrl(b.props.url);
        if (hash) seen.add(hash);
      }
      if (b?.children?.length) walk(b.children);
    }
  };
  for (const page of doc.pages ?? []) walk(page.blocks);
  return [...seen];
}

/**
 * doc 内の `shared-blob:<hash>` url を mapping に従って置換した新しい doc を返す。
 * mapping は hash → 新 url（ローカル MediaProvider が返したもの）。immutable。
 */
export function rewriteSharedBlobUrls(
  doc: GraphiumDocument,
  mapping: Map<string, string>,
): GraphiumDocument {
  if (mapping.size === 0) return doc;
  const remap = (blocks: any[]): any[] =>
    blocks.map((b) => {
      let next = b;
      if (
        MEDIA_TYPES.has(b?.type) &&
        typeof b?.props?.url === "string"
      ) {
        const hash = parseSharedBlobUrl(b.props.url);
        if (hash && mapping.has(hash)) {
          next = { ...b, props: { ...b.props, url: mapping.get(hash)! } };
        }
      }
      if (next?.children?.length) {
        next = { ...next, children: remap(next.children) };
      }
      return next;
    });
  return {
    ...doc,
    pages: doc.pages.map((p) => ({ ...p, blocks: remap(p.blocks) })),
  };
}

/**
 * バイト列から MIME タイプを推定する（マジックバイト判定）。
 * 識別できない場合は "application/octet-stream" を返す。
 */
export function sniffMimeType(bytes: Uint8Array): string {
  if (bytes.length >= 4) {
    // PNG: 89 50 4E 47
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
      return "image/png";
    // JPEG: FF D8 FF
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    // GIF: 47 49 46 38 ("GIF8")
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38)
      return "image/gif";
    // PDF: %PDF
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)
      return "application/pdf";
  }
  if (bytes.length >= 12) {
    // WebP: RIFF....WEBP
    if (
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    )
      return "image/webp";
    // MP4: ....ftyp
    if (
      bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
    )
      return "video/mp4";
  }
  if (bytes.length >= 3) {
    // MP3 (ID3 tagged): "ID3"
    if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return "audio/mpeg";
  }
  if (bytes.length >= 2) {
    // MP3 frame sync: FF F? (without ID3 tag)
    if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return "audio/mpeg";
  }
  return "application/octet-stream";
}

/** ファイル名の拡張子から MIME を推定する（マジックバイトで分からない docx / xlsx / csv / wav / m4a など用）。知らなければ null */
export function mimeFromFilename(filename: string): string | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (!ext || ext === filename.toLowerCase()) return null;
  return FILENAME_MIME[ext] ?? null;
}

const FILENAME_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  flac: "audio/flac",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  zip: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/** MIME → 拡張子（restored ファイル名生成用、知らないものは "bin"） */
export function extensionForMime(mime: string): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "application/pdf":
      return "pdf";
    case "video/mp4":
      return "mp4";
    case "audio/mpeg":
      return "mp3";
    default:
      return "bin";
  }
}

export type FetchBlobBytes = (ref: BlobRef) => Promise<Uint8Array>;
export type UploadMediaFile = (file: File) => Promise<{ url: string }>;

export type MaterializeOptions = {
  /** SharedEntry.extra.blobs[] — hash 引きで bytes 取得元の BlobRef を選ぶ（mime があれば登録時の種類に使う） */
  blobs: (BlobRef & { mime?: string })[];
  /** BlobRef からバイト列を読み出す（典型: LocalFolderBlobProvider.get） */
  fetchBytes: FetchBlobBytes;
  /** バイト列を自分の MediaProvider に登録して新 url を返す（典型: handleUploadMedia） */
  uploadMedia: UploadMediaFile;
};

export type MaterializeResult = {
  /** url 置換後の新しい doc */
  doc: GraphiumDocument;
  /** materialize された hash → 新 url */
  mapping: Map<string, string>;
  /** 解決できなかった hash（extra.blobs に対応 BlobRef が無い等） */
  missing: string[];
};

/**
 * doc 内の `shared-blob:<hash>` を MediaProvider 配下の url に置換する。
 *
 * - 各 hash について extra.blobs から BlobRef を引き、bytes を取得
 * - mime を sniff して File を構築 → uploadMedia → 新 url
 * - 全 hash 分繰り返して mapping を作り、rewriteSharedBlobUrls で適用
 *
 * 解決できなかった hash は missing に積んで返す（doc 内の url はそのまま `shared-blob:` で残る）。
 * 呼び出し側でユーザーに警告するなど、ハンドリングは任せる。
 */
export async function materializeSharedBlobs(
  doc: GraphiumDocument,
  opts: MaterializeOptions,
): Promise<MaterializeResult> {
  const hashes = collectSharedBlobHashes(doc);
  if (hashes.length === 0) {
    return { doc, mapping: new Map(), missing: [] };
  }
  const blobByHash = new Map<string, BlobRef & { mime?: string }>();
  for (const b of opts.blobs) {
    if (b && typeof b.hash === "string") blobByHash.set(b.hash, b);
  }
  const mapping = new Map<string, string>();
  const missing: string[] = [];
  for (const hash of hashes) {
    const ref = blobByHash.get(hash);
    if (!ref) {
      missing.push(hash);
      continue;
    }
    try {
      const bytes = await opts.fetchBytes(ref);
      // 種類は 宣言された mime > マジックバイト > ファイル名の拡張子 の順で決める
      const sniffed = sniffMimeType(bytes);
      const mime =
        ref.mime ||
        (sniffed !== "application/octet-stream" ? sniffed : ((ref.filename && mimeFromFilename(ref.filename)) || sniffed));
      const filename = ref.filename || `restored-${hash.replace(/[^a-z0-9]/gi, "").slice(0, 12)}.${extensionForMime(mime)}`;
      const file = new File([bytes as BlobPart], filename, { type: mime });
      const { url } = await opts.uploadMedia(file);
      mapping.set(hash, url);
    } catch {
      missing.push(hash);
    }
  }
  return {
    doc: rewriteSharedBlobUrls(doc, mapping),
    mapping,
    missing,
  };
}
