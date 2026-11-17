// ノートを Word（.docx）で書き出す入口
//
// 画像の読み込みの既定実装・Document の組み立て・Packer・保存をここに持つ。
// ブロックの落とし込みは normalize-blocks.ts、Word の要素への変換は blocks-to-docx.ts。
// 画像は 1 枚読めなくても全体は失敗にせず、その箇所だけ差し込み文字になる。
// 外部の URL（http / https）は取りに行かない（既定で外部へ通信しないアプリの決まり）。

import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import type { TableMeta } from "../../lib/document-types";
import { downloadBlob } from "../../lib/download-file";
import { getActiveProvider } from "../../lib/storage/registry";
import { sniffMimeType } from "../sharing/materialize-blobs";
import { buildTableNames } from "../markdown-export/blocks-to-markdown";
import { sanitizeFilename } from "../markdown-export/filenames";
import {
  cleanXmlText,
  renderBlocksToDocx,
  type DocxImage,
} from "./blocks-to-docx";
import { readImageInfo } from "./image-info";
import { normalizeBlocksForDocx } from "./normalize-blocks";

export type { DocxImage };

export type DocxExportOptions = {
  title: string;
  blocks: unknown;
  tableMeta?: Record<string, TableMeta>;
  /** チャートなど、画面の描画を画像にして返す。null ならフォールバック（表と説明文）を出す */
  captureBlockImage?: (blockId: string) => Promise<DocxImage | null>;
  loadMedia?: (url: string) => Promise<DocxImage | null>;
  loadInlineImage?: (fileId: string) => Promise<DocxImage | null>;
};

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
/** canvas に直すときの一辺・面積の上限（巨大な SVG で大きな canvas を確保しない） */
export const MAX_CANVAS_SIDE = 8192;
export const MAX_CANVAS_PIXELS = 40_000_000;

// ─────────────────────────────────────────────
// 画像の既定の読み込み
// ─────────────────────────────────────────────

/** WebP・SVG など Word が直接読めない画像を、document があるときだけ canvas で PNG にする */
async function rasterizeToPng(bytes: Uint8Array, mime: string): Promise<DocxImage | null> {
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof Image === "undefined") return null;
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image decode failed"));
      el.src = url;
    });
    const width = img.naturalWidth || 600;
    const height = img.naturalHeight || 400;
    if (width > MAX_CANVAS_SIDE || height > MAX_CANVAS_SIDE || width * height > MAX_CANVAS_PIXELS) return null;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext("2d");
    if (!g) return null;
    g.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return null;
    const data = new Uint8Array(await blob.arrayBuffer());
    const info = readImageInfo(data);
    return info ? { data, type: info.type, width: info.width, height: info.height } : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** バイト列 → DocxImage。PNG / JPEG / GIF / BMP は縦横を読み、それ以外は PNG に直す。失敗は null */
export async function bytesToDocxImage(bytes: Uint8Array | undefined | null): Promise<DocxImage | null> {
  try {
    if (!bytes || bytes.length === 0) return null;
    const info = readImageInfo(bytes);
    if (info) return { data: bytes, ...info };
    let mime = sniffMimeType(bytes);
    if (mime === "application/octet-stream") {
      const head = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart();
      if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) mime = "image/svg+xml";
    }
    if (!mime.startsWith("image/")) return null;
    return await rasterizeToPng(bytes, mime);
  } catch {
    return null;
  }
}

function decodeDataUrl(url: string): Uint8Array | null {
  const m = /^data:image\/[^;,]+((?:;[^;,]+)*?),(.*)$/s.exec(url);
  if (!m) return null;
  try {
    if (/;base64/i.test(m[1])) {
      const bin = atob(m[2].replace(/\s/g, ""));
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new TextEncoder().encode(decodeURIComponent(m[2]));
  } catch {
    return null;
  }
}

async function readByFileId(fileId: string): Promise<DocxImage | null> {
  try {
    const bytes = await getActiveProvider().readMediaBytes?.(fileId, MAX_MEDIA_BYTES);
    return await bytesToDocxImage(bytes);
  } catch {
    return null;
  }
}

/** 既定の loadMedia。素材ライブラリの参照と data: だけ読む（外部 URL は取りに行かない） */
export async function defaultLoadMedia(url: string): Promise<DocxImage | null> {
  try {
    if (typeof url !== "string" || !url) return null;
    if (url.startsWith("data:image/")) {
      // data: は読み込み前の長さで切る（base64 は元の約 4/3 倍）
      if (url.length > MAX_MEDIA_BYTES * 1.4) return null;
      return await bytesToDocxImage(decodeDataUrl(url));
    }
    const fileId = getActiveProvider().extractFileId(url);
    return fileId ? await readByFileId(fileId) : null;
  } catch {
    return null;
  }
}

/** 既定の loadInlineImage */
export async function defaultLoadInlineImage(fileId: string): Promise<DocxImage | null> {
  return readByFileId(fileId);
}

// ─────────────────────────────────────────────
// 組み立て・保存
// ─────────────────────────────────────────────

/** ノートを .docx の Blob にする */
export async function buildNoteDocxBlob(options: DocxExportOptions): Promise<Blob> {
  const { title, blocks, tableMeta } = options;
  const normalized = normalizeBlocksForDocx(blocks, buildTableNames(blocks, tableMeta));
  const { children, numbering } = await renderBlocksToDocx(normalized, {
    captureBlockImage: options.captureBlockImage,
    loadMedia: options.loadMedia ?? defaultLoadMedia,
    loadInlineImage: options.loadInlineImage ?? defaultLoadInlineImage,
  });

  const cleanTitle = cleanXmlText(title ?? "").replace(/\s+/g, " ").trim();
  const titleParagraph = cleanTitle
    ? [
        new Paragraph({
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.LEFT,
          children: [new TextRun({ text: cleanTitle })],
        }),
      ]
    : [];

  const doc = new Document({
    title: cleanTitle,
    creator: "Graphium",
    styles: {
      default: {
        document: {
          run: { font: { ascii: "Arial", hAnsi: "Arial", eastAsia: "Yu Gothic" }, size: 21 },
        },
      },
    },
    numbering: { config: numbering },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          },
        },
        children: [...titleParagraph, ...children, ...(children.length === 0 && titleParagraph.length === 0 ? [new Paragraph({ children: [] })] : [])],
      },
    ],
  });
  return Packer.toBlob(doc);
}

/** ノートを Word ファイルとして保存する。保存を実行したら true、キャンセルなら false */
export async function exportNoteToDocx(options: DocxExportOptions): Promise<boolean> {
  const blob = await buildNoteDocxBlob(options);
  return downloadBlob(blob, `${sanitizeFilename(options.title)}.docx`);
}
