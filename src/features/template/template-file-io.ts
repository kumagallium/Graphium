// テンプレートのファイル書き出し・読み込みの、実行環境につなぐ部分。
// 形式そのものの読み書きは template-file.ts（純関数）。ここは素材のバイト列の取得、
// ダウンロード、手元への保存といった副作用を受け持つ。

import { getActiveProvider } from "../../lib/storage/registry";
import { base64ToBytes } from "../../lib/base64";
import { downloadBlob } from "../../lib/download-file";
import { isTauri } from "../../lib/platform";
import { getBlobRoot, LocalFolderBlobProvider, type BlobRef, type SharedEntry } from "../../lib/storage/shared";
import { getSharedEntryRoot, readSharedEntryBody } from "../sharing/shared-library-store";
import { t as tStatic } from "../../i18n";
import { confirmAction } from "../../ui/confirm-dialog";
import { buildDocumentFromTemplateDef } from "./from-page-template";
import { createTemplate, deserializeTemplate } from "./save";
import type { TemplateDef } from "./templates";
import {
  TEMPLATE_FILE_MAX_MEDIA_BYTES,
  buildTemplateFile,
  parseTemplateFile,
  prepareTemplateImport,
  serializeTemplateFile,
  templateFileName,
} from "./template-file";
import type { PageTemplate } from "./types";
import {
  listUserTemplates,
  getUserTemplateProvider,
  saveImportedUserTemplate,
  type UserTemplateRecord,
} from "./user-template-store";

export type ExportSource =
  | { kind: "official"; def: TemplateDef }
  | { kind: "user"; record: UserTemplateRecord }
  | { kind: "shared"; entry: SharedEntry };

export type ExportOutcome =
  | { status: "saved"; missing: number }
  | { status: "cancelled" }
  | { status: "tooLarge"; totalMb: number; limitMb: number }
  | { status: "failed"; error: string };

const toMb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

/**
 * 手元の素材のバイト列。デスクトップは Rust 経由。ブラウザ版は保存先の readMediaBytes を使い、
 * 無いときだけ URL の fetch に倒す（local-media:// などのカスタムスキームは fetch で読めない）
 */
async function fetchLocalBytes(ref: { url: string; fileId: string }): Promise<Uint8Array> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return base64ToBytes(await invoke<string>("read_media_file", { fileId: ref.fileId }));
  }
  const provider = getActiveProvider();
  if (provider.readMediaBytes) {
    const bytes = await provider.readMediaBytes(ref.fileId);
    if (bytes) return bytes;
  }
  const res = await fetch(ref.url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** テンプレートをファイルに書き出す（公式・自分・共有のどれでも） */
export async function exportTemplateToFile(src: ExportSource): Promise<ExportOutcome> {
  try {
    let title: string;
    let description: string | undefined;
    let template: PageTemplate;
    let fetchBlobBytes:
      | ((hash: string) => Promise<{ bytes: Uint8Array; filename?: string; mime?: string } | null>)
      | undefined;

    if (src.kind === "official") {
      title = tStatic(src.def.titleKey);
      description = tStatic(src.def.descKey);
      const doc = buildDocumentFromTemplateDef(src.def, {
        title,
        templateFrom: { officialTemplateId: src.def.id, title, usedAt: new Date().toISOString() },
      });
      const page = doc.pages[0];
      template = createTemplate({
        name: title,
        pageTitle: page.title,
        blocks: page.blocks,
        labels: Object.entries(page.labels ?? {}),
        attributes: [],
        tableMeta: page.tableMeta,
      });
    } else if (src.kind === "user") {
      title = src.record.title;
      description = src.record.description;
      template = src.record.template;
    } else {
      const extra = (src.entry.extra ?? {}) as Record<string, unknown>;
      const { body, verified } = await readSharedEntryBody(src.entry);
      // 共有された記録と中身が合わない。ノートを作るときと同じ文言で、渡してよいか聞く
      if (!verified && !(await confirmAction(tStatic("library.templateHashMismatchConfirm")))) {
        return { status: "cancelled" };
      }
      template = deserializeTemplate(new TextDecoder().decode(body));
      title = typeof extra.title === "string" && extra.title ? extra.title : template.name;
      description = typeof extra.description === "string" ? extra.description : undefined;
      const blobs = Array.isArray(extra.blobs) ? (extra.blobs as (BlobRef & { mime?: string })[]) : [];
      const blobRoot = getBlobRoot(getSharedEntryRoot(src.entry.id));
      if (blobRoot && blobs.length > 0) {
        const provider = new LocalFolderBlobProvider(blobRoot);
        fetchBlobBytes = async (hash) => {
          const ref = blobs.find((b) => b.hash === hash);
          return ref ? { bytes: await provider.get(ref), filename: ref.filename, mime: ref.mime } : null;
        };
      }
    }

    const built = await buildTemplateFile({
      title,
      description,
      template,
      extractFileId: (url) => getActiveProvider().extractFileId(url),
      fetchLocalBytes,
      fetchBlobBytes,
    });
    if (!built.ok) {
      return { status: "tooLarge", totalMb: toMb(built.totalBytes), limitMb: toMb(built.limitBytes) };
    }
    const blob = new Blob([serializeTemplateFile(built.file)], { type: "application/json;charset=utf-8" });
    const saved = await downloadBlob(blob, templateFileName(title));
    return saved ? { status: "saved", missing: built.missing } : { status: "cancelled" };
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}

export type ImportOutcome =
  | { status: "imported"; record: UserTemplateRecord; missing: number }
  | {
      status: "rejected";
      /** i18n キー（templateList.import.error.*） */
      messageKey: string;
      detail?: string;
    }
  | { status: "failed"; error: string };

/** 読み込むファイルの大きさの上限（同梱素材の上限 + base64 の増え分と本文の余裕） */
const MAX_FILE_BYTES = Math.ceil(TEMPLATE_FILE_MAX_MEDIA_BYTES * 1.4) + 2 * 1024 * 1024;

/** ファイルを検証して「自分のテンプレート」として保存する */
export async function importTemplateFromFile(
  file: File,
  deps: { uploadMedia: (file: File) => Promise<string> },
): Promise<ImportOutcome> {
  try {
    if (file.size > MAX_FILE_BYTES) {
      return { status: "rejected", messageKey: "templateList.import.error.tooLarge" };
    }
    const parsed = parseTemplateFile(await file.text());
    if (!parsed.ok) {
      return {
        status: "rejected",
        messageKey: `templateList.import.error.${parsed.reason}`,
        detail: parsed.detail,
      };
    }
    const provider = getUserTemplateProvider();
    if (!provider) return { status: "rejected", messageKey: "templateList.import.error.unsupported" };
    const existing = (await listUserTemplates(provider)).map((r) => r.title);
    const prepared = await prepareTemplateImport(parsed.file, {
      uploadMedia: async (f) => ({ url: await deps.uploadMedia(f) }),
      existingTitles: existing,
    });
    if (!prepared.ok) {
      return { status: "rejected", messageKey: "templateList.import.error.corrupt" };
    }
    const record = await saveImportedUserTemplate({
      title: prepared.title,
      description: prepared.description,
      template: prepared.template,
      provider,
    });
    return { status: "imported", record, missing: prepared.missing };
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}
