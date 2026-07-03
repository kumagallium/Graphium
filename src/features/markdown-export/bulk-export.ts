// 全ノートの一括エクスポート（Markdown zip）とバックアップ（生 JSON zip）
//
// 設定画面（ストレージタブ）から呼ばれる。アクティブな StorageProvider の
// listFiles / loadFile を使うので local(IndexedDB) / filesystem / server-fs の
// 3 プロバイダ全てで動く。アーカイブ・ゴミ箱のノートもファイル自体は
// ストレージに残っている（フラグはインデックス側）ため、listFiles で全件拾える。
//
// zip 内のファイル名は doc.title を優先する。GraphiumFile.name はプロバイダに
// よって `タイトル.graphium.json`（local）や `uuid.json`（filesystem）と
// 形式が違い、タイトルとして信頼できないため。
//
// zip は fflate の zipSync を使う。ノートはテキスト中心で小さく、
// 数百件規模でも同期圧縮で体感ブロックにはならない想定。

import { zipSync, strToU8, type Zippable } from "fflate";
import type { StorageProvider } from "../../lib/storage/types";
import type { GraphiumDocument, GraphiumFile } from "../../lib/document-types";
import { downloadBlob } from "../../lib/download-file";
import { assignZipNames, stripStorageExt } from "./filenames";
import { graphiumDocToMarkdown, buildMarkdownFileContent } from "./doc-to-markdown";

/** 一括エクスポートの結果サマリ（UI 表示用） */
export type BulkExportResult = {
  /** zip に入れられたファイル数 */
  exported: number;
  /** 読み込み・変換に失敗してスキップした数 */
  failed: number;
};

/** yyyymmdd 形式の日付（zip ファイル名用） */
function dateStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/** zip 内でのファイル名の元になるタイトルを決める（doc.title 優先） */
function titleForZip(doc: GraphiumDocument, file: GraphiumFile): string {
  const title = (doc.title ?? "").trim();
  return title || stripStorageExt(file.name);
}

/**
 * 1 グループ分のファイルを読み込んで変換し、zip エントリ名を dedupe して詰める。
 * 個々のノートの失敗は握りつぶさずカウントして続行する（1 件の破損で
 * 全体が失敗しないように）。
 */
async function addGroup(
  entries: Zippable,
  folder: string | null,
  ext: string,
  files: GraphiumFile[],
  load: (id: string) => Promise<GraphiumDocument>,
  convert: (doc: GraphiumDocument, title: string) => Promise<string> | string,
): Promise<BulkExportResult> {
  // 変換結果を一旦集めてから名前を割り当てる（dedupe に全タイトルが必要）
  const converted: { id: string; title: string; content: string }[] = [];
  let failed = 0;
  for (const file of files) {
    try {
      const doc = await load(file.id);
      const title = titleForZip(doc, file);
      converted.push({ id: file.id, title, content: await convert(doc, title) });
    } catch (e) {
      console.warn(`[markdown-export] failed to export ${folder ?? "notes"}/${file.id}:`, e);
      failed++;
    }
  }
  const names = assignZipNames(
    converted.map((c) => ({ id: c.id, title: c.title })),
    ext,
  );
  for (const c of converted) {
    const name = names.get(c.id)!;
    entries[folder ? `${folder}/${name}` : name] = strToU8(c.content);
  }
  return { exported: converted.length, failed };
}

/** entries を zip 化してダウンロードする */
async function downloadZip(entries: Zippable, filename: string): Promise<void> {
  const zipped = zipSync(entries);
  const blob = new Blob([zipped as unknown as BlobPart], { type: "application/zip" });
  await downloadBlob(blob, filename);
}

/**
 * 全ノートを Markdown に変換して zip でダウンロードする。
 */
export async function exportAllNotesAsMarkdownZip(
  provider: StorageProvider,
): Promise<BulkExportResult> {
  const entries: Zippable = {};
  const files = await provider.listFiles();
  const result = await addGroup(
    entries,
    null,
    ".md",
    files,
    (id) => provider.loadFile(id),
    async (doc, title) => buildMarkdownFileContent(title, await graphiumDocToMarkdown(doc)),
  );
  await downloadZip(entries, `graphium-notes-markdown-${dateStamp()}.zip`);
  return result;
}

/**
 * 全データの生 JSON バックアップを zip でダウンロードする。
 * Web 版（IndexedDB）ユーザーにとって唯一のデータ出口なので、通常ノートに
 * 加えて Knowledge（wiki）と Skill ドキュメントも対象にする。
 * メディア（画像・PDF 等のバイナリ）は含まない。
 */
export async function exportBackupZip(
  provider: StorageProvider,
): Promise<BulkExportResult> {
  const entries: Zippable = {};
  const toJson = (doc: GraphiumDocument) => JSON.stringify(doc, null, 2);
  let exported = 0;
  let failed = 0;

  // 通常ノート（アーカイブ・ゴミ箱含む全件）
  const notes = await provider.listFiles();
  const noteResult = await addGroup(entries, "notes", ".graphium.json", notes, (id) => provider.loadFile(id), toJson);
  exported += noteResult.exported;
  failed += noteResult.failed;

  // Knowledge（wiki）ドキュメント
  if (provider.listWikiFiles && provider.loadWikiFile) {
    const wikiFiles = await provider.listWikiFiles();
    const wikiResult = await addGroup(entries, "wiki", ".graphium.json", wikiFiles, (id) => provider.loadWikiFile!(id), toJson);
    exported += wikiResult.exported;
    failed += wikiResult.failed;
  }

  // Skill ドキュメント
  if (provider.listSkillFiles && provider.loadSkillFile) {
    const skillFiles = await provider.listSkillFiles();
    const skillResult = await addGroup(entries, "skills", ".graphium.json", skillFiles, (id) => provider.loadSkillFile!(id), toJson);
    exported += skillResult.exported;
    failed += skillResult.failed;
  }

  await downloadZip(entries, `graphium-backup-${dateStamp()}.zip`);
  return { exported, failed };
}
