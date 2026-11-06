// テンプレートのファイル（.graphium-template）の読み書き。純関数と、差し込み口つきの組み立てだけ。
//
// 設計判断:
// - 共有フォルダを読めない相手（学外・設定前）にメールで渡すための形式。JSON 1 つにして、
//   中の画像・PDF などは base64 で同梱する（相手の手元に何も無くても開ける）。
// - 本文の素材参照は共有テンプレートと同じ `shared-blob:<hash>` に揃えて書き出す。
//   手元の素材は中身の SHA-256 でハッシュを取って置き換える。読み込み側は共有テンプレートを
//   挿入するときと同じ materializeSharedBlobs で手元の素材に付け替えられる。
// - 元のノートの題名は書き出さない（外部の相手には不要）。読み込んだ側は「元のノート: 記録なし」になる。
// - 相手の環境では意味が無いもの（録音ブロックの fileId・表の行ノートリンク）は書き出し時に外す。
//   読めなかった素材・同梱されなかった shared-blob の参照は url を空にして「参照切れ」の表示に倒す
//   （書き出し元のパスや手元の素材 id を相手に残さない）。
// - 実行環境に依存する処理（素材のバイト列の取得・手元への登録）は呼び出し側から差し込む。

import type { GraphiumDocument } from "../../lib/document-types";
import { LATEST_DOCUMENT_VERSION } from "../../lib/document-migration";
import type { BlobRef } from "../../lib/storage/shared";
import { computeBlobHash } from "../../lib/storage/shared/hash";
import { base64ToBytes, bytesToBase64 } from "../../lib/base64";
import { sanitizeFilename } from "../markdown-export/filenames";
import {
  collectMediaRefs,
  makeSharedBlobUrl,
  rewriteMediaUrls,
} from "../sharing/auto-blob";
import {
  collectSharedBlobHashes,
  materializeSharedBlobs,
  mimeFromFilename,
  rewriteSharedBlobUrls,
  sniffMimeType,
} from "../sharing/materialize-blobs";
import type { PageTemplate } from "./types";

export const TEMPLATE_FILE_FORMAT = "graphium-template";
export const TEMPLATE_FILE_VERSION = 1;
export const TEMPLATE_FILE_EXT = ".graphium-template";
/** 同梱する素材の合計（バイト）の上限。メールに添付できる大きさを超えるものは書き出さない */
export const TEMPLATE_FILE_MAX_MEDIA_BYTES = 25 * 1024 * 1024;

export type TemplateFileMedia = {
  /** 中身の SHA-256（"sha256:<hex>"）。本文では `shared-blob:<hash>` で参照する */
  hash: string;
  filename?: string;
  mime?: string;
  base64: string;
};

export type TemplateFile = {
  format: typeof TEMPLATE_FILE_FORMAT;
  version: typeof TEMPLATE_FILE_VERSION;
  exportedAt: string;
  title: string;
  description?: string;
  template: PageTemplate;
  media?: TemplateFileMedia[];
};

/** 書き出しのファイル名（`<テンプレート名>.graphium-template`）。使えない文字は既存の作法で置き換える */
export function templateFileName(title: string): string {
  return `${sanitizeFilename(title, "Template")}${TEMPLATE_FILE_EXT}`;
}

/** 題名が既存と重なるときは「（2）」「（3）」…を付けて避ける */
export function uniqueTemplateTitle(title: string, existing: Iterable<string>): string {
  const used = new Set(existing);
  if (!used.has(title)) return title;
  for (let n = 2; ; n++) {
    const candidate = `${title}（${n}）`;
    if (!used.has(candidate)) return candidate;
  }
}

/** blocks だけを持つ最小の文書（auto-blob / materialize が文書を受け取るため） */
function blocksDoc(template: PageTemplate): GraphiumDocument {
  const now = new Date().toISOString();
  return {
    version: LATEST_DOCUMENT_VERSION,
    title: template.name,
    pages: [
      {
        id: "main",
        title: template.pageTitle,
        blocks: template.blocks,
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    createdAt: now,
    modifiedAt: now,
  };
}

// ── 書き出し ──

export type BuildTemplateFileParams = {
  title: string;
  description?: string;
  template: PageTemplate;
  /** 手元の素材の URL → fileId（外部 URL などは null で、そのまま残す） */
  extractFileId?: (url: string) => string | null;
  /** 手元の素材のバイト列。読めないときは例外 */
  fetchLocalBytes?: (ref: { url: string; fileId: string }) => Promise<Uint8Array>;
  /** `shared-blob:<hash>` のバイト列（共有テンプレート用）。読めないときは null */
  fetchBlobBytes?: (hash: string) => Promise<{ bytes: Uint8Array; filename?: string; mime?: string } | null>;
  now?: Date;
};

export type BuildTemplateFileResult =
  | {
      ok: true;
      file: TemplateFile;
      /** 同梱できなかった素材の数（読めなかった分。本文の参照はそのまま残る） */
      missing: number;
    }
  | { ok: false; reason: "tooLarge"; totalBytes: number; limitBytes: number };

/**
 * テンプレートをファイルの形にする。素材は同梱し、本文の参照を `shared-blob:<hash>` に揃える。
 * 同梱する素材の合計が上限を超えるときは何も作らず、理由を返す。
 */
export async function buildTemplateFile(
  params: BuildTemplateFileParams,
): Promise<BuildTemplateFileResult> {
  const template = sanitizeTemplateForExport(params.template);
  let doc = blocksDoc(template);
  const names = collectMediaNames(template.blocks);
  const media = new Map<string, { bytes: Uint8Array; filename?: string; mime?: string }>();
  // 本文の url → 置き換え先。読めなかったものは "" （参照切れ）にする
  const mapping = new Map<string, string>();
  let missing = 0;

  // 手元の素材: 中身から hash を取り、本文の URL を shared-blob に置き換える
  if (params.extractFileId && params.fetchLocalBytes) {
    for (const ref of collectMediaRefs(doc, params.extractFileId)) {
      try {
        const bytes = await params.fetchLocalBytes(ref);
        const hash = await computeBlobHash(bytes);
        mapping.set(ref.url, makeSharedBlobUrl(hash));
        if (!media.has(hash)) media.set(hash, { bytes, filename: names.get(ref.url) });
      } catch {
        mapping.set(ref.url, "");
        missing++;
      }
    }
    doc = rewriteMediaUrls(doc, mapping);
  }

  // 共有テンプレートの素材（置き場から読む）。同梱できなかった参照も空にする
  for (const hash of collectSharedBlobHashes(doc)) {
    if (media.has(hash)) continue;
    try {
      const got = params.fetchBlobBytes ? await params.fetchBlobBytes(hash) : null;
      if (got) {
        media.set(hash, {
          bytes: got.bytes,
          filename: names.get(makeSharedBlobUrl(hash)) || got.filename,
          mime: got.mime,
        });
      } else {
        mapping.set(makeSharedBlobUrl(hash), "");
        missing++;
      }
    } catch {
      mapping.set(makeSharedBlobUrl(hash), "");
      missing++;
    }
  }
  if (mapping.size > 0) doc = rewriteMediaUrls(doc, mapping);

  let total = 0;
  for (const m of media.values()) total += m.bytes.length;
  if (total > TEMPLATE_FILE_MAX_MEDIA_BYTES) {
    return { ok: false, reason: "tooLarge", totalBytes: total, limitBytes: TEMPLATE_FILE_MAX_MEDIA_BYTES };
  }

  const description = params.description?.trim();
  const file: TemplateFile = {
    format: TEMPLATE_FILE_FORMAT,
    version: TEMPLATE_FILE_VERSION,
    exportedAt: (params.now ?? new Date()).toISOString(),
    title: params.title,
    ...(description ? { description } : {}),
    template: { ...template, blocks: doc.pages[0].blocks },
    ...(media.size > 0
      ? {
          media: [...media.entries()].map(([hash, m]) => ({
            hash,
            ...(m.filename ? { filename: m.filename } : {}),
            // 種類は 宣言 > ファイル名の拡張子 > マジックバイト の順（docx / wav / m4a などは中身から分からない）
            mime: m.mime || (m.filename && mimeFromFilename(m.filename)) || sniffMimeType(m.bytes),
            base64: bytesToBase64(m.bytes),
          })),
        }
      : {}),
  };
  return { ok: true, file, missing };
}

const MEDIA_BLOCK_TYPES = new Set(["image", "video", "audio", "file", "pdf"]);

/** 素材ブロックの url → 表示名（props.name）。ファイル名と拡張子を相手の側で戻すために使う */
function collectMediaNames(blocks: any[]): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (list: any[]) => {
    for (const b of list ?? []) {
      if (MEDIA_BLOCK_TYPES.has(b?.type) && typeof b?.props?.url === "string" && typeof b?.props?.name === "string" && b.props.name) {
        if (!out.has(b.props.url)) out.set(b.props.url, b.props.name);
      }
      if (Array.isArray(b?.children)) walk(b.children);
    }
  };
  walk(blocks);
  return out;
}

/**
 * 相手の環境では意味が無いものを外した写しを返す（元は変えない）。
 * - 表の行ノートリンク（tableMeta.noteLinks）は書き出した人のノート id を指すので落とす
 *   （共有テンプレートから新規ノートを作るときと同じ扱い）
 * - 録音ブロック（meetingTranscript）の recordingId / fileId / startedAt は空に戻して「録音を始める」状態にする
 * - @メンションは本文では題名の文字（"@題名"）で、ノート id は本文に持たないのでそのまま
 */
export function sanitizeTemplateForExport(template: PageTemplate): PageTemplate {
  const clean = (blocks: any[]): any[] =>
    blocks.map((b) => {
      let next = b;
      if (b?.type === "meetingTranscript") {
        next = { ...b, props: { ...b.props, recordingId: "", fileId: "", startedAt: "" } };
      }
      if (Array.isArray(next?.children) && next.children.length > 0) {
        next = { ...next, children: clean(next.children) };
      }
      return next;
    });
  let tableMeta = template.tableMeta;
  if (tableMeta) {
    tableMeta = Object.fromEntries(
      Object.entries(tableMeta).map(([id, m]) => {
        const { noteLinks: _dropped, ...rest } = m as any;
        return [id, rest];
      }),
    );
  }
  return {
    ...template,
    blocks: clean(structuredClone(template.blocks ?? [])),
    ...(tableMeta ? { tableMeta } : {}),
  };
}

export function serializeTemplateFile(file: TemplateFile): string {
  return JSON.stringify(file, null, 2);
}

// ── 読み込み ──

export type ParseTemplateFileResult =
  | { ok: true; file: TemplateFile }
  | {
      ok: false;
      /** notJson: JSON として読めない / wrongFormat: 別の形式 / unsupportedVersion: 新しすぎる / invalid: 必須の項目が足りない・壊れている */
      reason: "notJson" | "wrongFormat" | "unsupportedVersion" | "invalid";
      detail?: string;
    };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** ファイルの中身（文字列）を検証して TemplateFile にする。知らない形は理由つきで断る */
export function parseTemplateFile(text: string): ParseTemplateFileResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "notJson" };
  }
  if (!isObject(raw) || raw.format !== TEMPLATE_FILE_FORMAT) return { ok: false, reason: "wrongFormat" };
  if (typeof raw.version !== "number" || !Number.isInteger(raw.version) || raw.version < 1) {
    return { ok: false, reason: "invalid", detail: "version" };
  }
  if (raw.version > TEMPLATE_FILE_VERSION) {
    return { ok: false, reason: "unsupportedVersion", detail: String(raw.version) };
  }
  if (typeof raw.title !== "string" || !raw.title.trim()) {
    return { ok: false, reason: "invalid", detail: "title" };
  }
  const tpl = raw.template;
  if (!isObject(tpl) || !Array.isArray(tpl.blocks)) {
    return { ok: false, reason: "invalid", detail: "template" };
  }
  if (raw.media !== undefined && !Array.isArray(raw.media)) {
    return { ok: false, reason: "invalid", detail: "media" };
  }
  const media: TemplateFileMedia[] = [];
  for (const m of (raw.media as unknown[] | undefined) ?? []) {
    if (!isObject(m) || typeof m.hash !== "string" || !m.hash || typeof m.base64 !== "string") {
      return { ok: false, reason: "invalid", detail: "media" };
    }
    media.push({
      hash: m.hash,
      ...(typeof m.filename === "string" && m.filename ? { filename: m.filename } : {}),
      ...(typeof m.mime === "string" && m.mime ? { mime: m.mime } : {}),
      base64: m.base64,
    });
  }
  // 本文の形を確かめる。知らない形は壊れたファイルとして断る
  if (!tpl.blocks.every(isObject)) return { ok: false, reason: "invalid", detail: "blocks" };
  for (const field of ["labels", "attributes"] as const) {
    const v = tpl[field];
    if (v === undefined) continue;
    if (!Array.isArray(v) || !v.every((e) => Array.isArray(e) && e.length >= 2 && typeof e[0] === "string")) {
      return { ok: false, reason: "invalid", detail: field };
    }
  }
  for (const field of ["tableMeta", "mediaInlineLabels"] as const) {
    const v = tpl[field];
    if (v === undefined) continue;
    if (!isObject(v) || !Object.values(v).every(isObject)) return { ok: false, reason: "invalid", detail: field };
  }
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  const title = raw.title.trim();
  const template: PageTemplate = {
    ...(tpl as unknown as PageTemplate),
    name: typeof tpl.name === "string" ? tpl.name : title,
    savedAt: typeof tpl.savedAt === "string" ? tpl.savedAt : new Date().toISOString(),
    pageTitle: typeof tpl.pageTitle === "string" ? tpl.pageTitle : title,
    labels: Array.isArray(tpl.labels) ? (tpl.labels as PageTemplate["labels"]) : [],
    attributes: Array.isArray(tpl.attributes) ? (tpl.attributes as PageTemplate["attributes"]) : [],
  };
  return {
    ok: true,
    file: {
      format: TEMPLATE_FILE_FORMAT,
      version: TEMPLATE_FILE_VERSION,
      exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : "",
      title,
      ...(description ? { description } : {}),
      template,
      ...(media.length > 0 ? { media } : {}),
    },
  };
}

export type ImportTemplateFileResult =
  | {
      ok: true;
      /** 重なりを避けた題名 */
      title: string;
      description?: string;
      /** 素材を手元のものに付け替えた本文 */
      template: PageTemplate;
      /** 付け替えられなかった素材の数 */
      missing: number;
    }
  | { ok: false; reason: "corrupt"; detail: string };

/**
 * 読み込んだファイルを「自分のテンプレート」にできる形へ整える。
 * 同梱の素材は中身の hash を確かめてから手元の素材として登録し（uploadMedia）、
 * 本文の参照を付け替える。hash が合わない素材があれば、壊れたファイルとして断る。
 */
export async function prepareTemplateImport(
  file: TemplateFile,
  deps: {
    uploadMedia: (file: File) => Promise<{ url: string }>;
    existingTitles: Iterable<string>;
  },
): Promise<ImportTemplateFileResult> {
  const bytesByHash = new Map<string, Uint8Array>();
  const blobs: BlobRef[] = [];
  for (const m of file.media ?? []) {
    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(m.base64);
    } catch {
      return { ok: false, reason: "corrupt", detail: m.hash };
    }
    if ((await computeBlobHash(bytes)) !== m.hash) return { ok: false, reason: "corrupt", detail: m.hash };
    bytesByHash.set(m.hash, bytes);
    blobs.push({
      provider: "file",
      uri: "",
      hash: m.hash,
      size: bytes.length,
      ...(m.filename ? { filename: m.filename } : {}),
      ...(m.mime ? { mime: m.mime } : {}),
    });
  }

  const materialized = await materializeSharedBlobs(blocksDoc(file.template), {
    blobs,
    fetchBytes: async (ref) => {
      const bytes = bytesByHash.get(ref.hash);
      if (!bytes) throw new Error("missing");
      return bytes;
    },
    uploadMedia: deps.uploadMedia,
  });

  // 付け替えられなかった参照（同梱されていない shared-blob など）は url を空にして「参照切れ」に倒す。
  // 書き出し元の置き場の参照を手元に残さない
  const leftover = new Map<string, string>();
  for (const h of collectSharedBlobHashes(materialized.doc)) leftover.set(h, "");
  const finalDoc = rewriteSharedBlobUrls(materialized.doc, leftover);

  const title = uniqueTemplateTitle(file.title, deps.existingTitles);
  return {
    ok: true,
    title,
    ...(file.description ? { description: file.description } : {}),
    template: { ...file.template, name: title, blocks: finalDoc.pages[0].blocks },
    missing: materialized.missing.length,
  };
}
