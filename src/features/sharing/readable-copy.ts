// 共有フォルダの「読める写し」を置く（共有・再共有のたびに呼ぶ）。
//
// 共有フォルダの中身（<root>/notes/<id>.json）は Graphium が無いと読めない。共有フォルダごとの
// スイッチ（SharedFolder.readableCopies）が入っていると、同じ共有フォルダの readable/notes/ に
// Markdown（.md）と来歴（.prov.jsonld）を置く。ファイル名は Rust（shared_readable_sync）が決める
// ので、ここからは題と id だけを渡し、パスは渡さない。
//
// 設計の決まり:
// - 写しの中身は「共有したものと同じ範囲」。共有コピーに載せないもの（AI チャット・編集の履歴・メモ）は
//   写しにも載せない（呼び出し側が履歴を落とした doc を渡し、メモの索引は渡さない）
// - 写しの失敗で共有そのものを失敗にしない。ただし黙らず、結果として返す
// - スイッチが切（または写しの材料が無い）のときは、その id の古い写しを消すよう Rust に頼む
//   （古い中身が共有フォルダに残らないように）

import { invoke } from "@tauri-apps/api/core";
import type { GraphiumDocument } from "../../lib/document-types";
import type { AuthorIdentity } from "../document-provenance/types";
import type { GraphiumIndex } from "../navigation/index-file";
import type { MediaIndexEntry } from "../asset-browser/media-index";
import { findSharedFolderByRoot } from "../../lib/storage/shared/config";
import { buildMarkdownFileContent, graphiumDocToMarkdown } from "../markdown-export/doc-to-markdown";
import { buildNoteProvJsonLdText } from "../prov-export/note-jsonld-text";

export type ReadableCopyContext = {
  /** 手元のノートの id（来歴の中でこのノートを指す名前になる） */
  noteId: string;
  /** ノートの索引（つながりの相手の種類と題を引く） */
  noteIndex?: GraphiumIndex | null;
  /** 素材の索引（素材の名前を引く） */
  mediaIndex?: MediaIndexEntry[] | Map<string, MediaIndexEntry> | null;
};

export type ReadableCopyStatus = "written" | "removed" | "off" | "failed";

export type SyncReadableCopyInput = {
  root: string;
  authorEmail: string;
  /** 共有 id（uuidv7） */
  sharedId: string;
  title: string;
  /** 実際に共有した doc（素材を shared-blob: に置き換え、履歴を落としたもの） */
  entryDoc: GraphiumDocument;
  /** 来歴を組む doc（素材の URL は元のまま。チャットと編集の履歴は落としたもの） */
  provDoc: GraphiumDocument;
  author: AuthorIdentity;
  context?: ReadableCopyContext;
  /** 共有した時刻（ISO 8601） */
  sharedAt: string;
};

/** 前付け（YAML）。値は JSON.stringify で引用して、改行や記号で崩れないようにする。メールアドレスは書かない */
function buildFrontMatter(input: SyncReadableCopyInput, noteId: string): string {
  const q = (v: string) => JSON.stringify(v);
  return [
    "---",
    `title: ${q(input.title)}`,
    `graphium_note_id: ${q(noteId)}`,
    `graphium_shared_id: ${q(input.sharedId)}`,
    `author: ${q(input.author.name)}`,
    `shared_at: ${q(input.sharedAt)}`,
    "---",
    "",
  ].join("\n");
}

/**
 * 読める写しを置く（スイッチが入っているとき）／古い写しを消す（切のとき）。
 * 例外は投げない。失敗は { status: "failed", error } で返す。
 */
export async function syncReadableCopy(
  input: SyncReadableCopyInput,
): Promise<{ status: ReadableCopyStatus; error?: string }> {
  try {
    const enabled = findSharedFolderByRoot(input.root)?.readableCopies === true;
    const context = input.context;
    if (!enabled || !context) {
      await invoke("shared_readable_sync", {
        root: input.root,
        entryType: "notes",
        id: input.sharedId,
        title: "",
        markdown: null,
        prov: null,
        authorEmail: input.authorEmail,
      });
      return { status: "off" };
    }
    const markdown =
      buildFrontMatter(input, context.noteId) +
      "\n" +
      buildMarkdownFileContent(input.title, await graphiumDocToMarkdown(input.entryDoc));
    // メモの索引（captureIndex）は渡さない。メールアドレスも渡さない（名前だけ）
    const prov = buildNoteProvJsonLdText(input.provDoc, context.noteId, {
      noteIndex: context.noteIndex ?? null,
      mediaIndex: context.mediaIndex ?? null,
      identity: { name: input.author.name },
      options: { includeChats: false },
    });
    await invoke("shared_readable_sync", {
      root: input.root,
      entryType: "notes",
      id: input.sharedId,
      title: input.title,
      markdown,
      prov,
      authorEmail: input.authorEmail,
    });
    return { status: "written" };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.warn("[readable-copy] 読める写しを置けませんでした:", error);
    return { status: "failed", error };
  }
}
