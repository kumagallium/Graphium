// ドロップされたファイル群の収集
//
// DataTransfer.items[i].webkitGetAsEntry() が使えるブラウザでは、フォルダごと
// 落とされた場合に FileSystemDirectoryEntry を再帰的に辿ってフォルダ構造を
// 復元する。使えない環境（entry が全部 null 等）では dt.files をそのまま渡す
// フォールバックにする。
//
// ドットで始まるファイル・フォルダ（.obsidian, .git, .DS_Store 等）もここでは
// 落とさない。対象外の判定は classify（次段）に任せ、「何件除外したか」を
// 利用者に見せる方針のため、黙って捨てない。

import { type IntakeFile, toIntakeFiles } from "./types";

// lib.dom.d.ts に無い File System Entries API の最小限の型
interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  fullPath: string;
}
interface FileSystemFileEntryLike extends FileSystemEntryLike {
  isFile: true;
  file(success: (file: File) => void, error?: (err: unknown) => void): void;
}
interface FileSystemDirectoryReaderLike {
  readEntries(
    success: (entries: FileSystemEntryLike[]) => void,
    error?: (err: unknown) => void,
  ): void;
}
interface FileSystemDirectoryEntryLike extends FileSystemEntryLike {
  isDirectory: true;
  createReader(): FileSystemDirectoryReaderLike;
}

function entryToFile(entry: FileSystemFileEntryLike): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

/**
 * ディレクトリの全エントリを読み切る。Chrome 系は readEntries を 1 回呼ぶと
 * 最大 100 件しか返さない仕様があるため、空配列が返るまで繰り返し呼ぶ。
 */
function readAllEntries(reader: FileSystemDirectoryReaderLike): Promise<FileSystemEntryLike[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntryLike[] = [];
    const readNext = () => {
      reader.readEntries((entries) => {
        if (entries.length === 0) {
          resolve(all);
          return;
        }
        all.push(...entries);
        readNext();
      }, reject);
    };
    readNext();
  });
}

async function walkEntry(entry: FileSystemEntryLike, out: IntakeFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await entryToFile(entry as FileSystemFileEntryLike);
    // fullPath は "/foo/bar.md" 形式。先頭の "/" を落として相対パスにする
    const path = entry.fullPath.replace(/^\/+/, "");
    out.push({ file, path });
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntryLike).createReader();
    const children = await readAllEntries(reader);
    for (const child of children) {
      await walkEntry(child, out);
    }
  }
}

/**
 * items を 1 件ずつ見て、entry が取れたものは辿り、取れなくても
 * item.getAsFile() が使えればファイルとして拾う（混在ドロップ対応）。
 * それぞれ 1 件も取れなかった要素だけを返し、全滅していれば呼び出し元で
 * dt.files へフォールバックする
 */
async function collectViaItems(items: DataTransferItem[]): Promise<IntakeFile[] | null> {
  const out: IntakeFile[] = [];
  let collectedAny = false;

  for (const item of items) {
    // webkitGetAsEntry は型定義上 DataTransferItem に存在するが、環境によっては
    // 未実装で undefined/null を返す
    const getEntry = (item as unknown as { webkitGetAsEntry?: () => FileSystemEntryLike | null })
      .webkitGetAsEntry;
    const entry = typeof getEntry === "function" ? getEntry.call(item) : null;
    if (entry) {
      collectedAny = true;
      await walkEntry(entry, out);
      continue;
    }
    // entry が取れなくても、この項目がファイルなら getAsFile で拾う
    if (item.kind === "file" && typeof item.getAsFile === "function") {
      const file = item.getAsFile();
      if (file) {
        collectedAny = true;
        out.push({ file, path: file.name });
      }
    }
  }

  return collectedAny ? out : null;
}

/** ドロップされた DataTransfer からファイル一覧を（フォルダなら再帰的に）収集する */
export async function collectDroppedFiles(dt: DataTransfer): Promise<IntakeFile[]> {
  const items = dt.items ? Array.from(dt.items) : [];

  if (items.length > 0) {
    const collected = await collectViaItems(items);
    if (collected !== null) return collected;
  }

  // entry も getAsFile も 1 件も取れなかったときだけ dt.files にフォールバック
  return toIntakeFiles(Array.from(dt.files ?? []));
}
