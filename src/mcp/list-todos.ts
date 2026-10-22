// list_todos の本体: まだチェックしていないチェックリスト項目を、ノート横断で返す。
//
// 読むのは索引（NoteIndexEntry.checklist、v32）だけで、ノート本体は開かない。
// Graphium はやることの「状態」（期限・優先度・担当・取り下げ）を持たない。ここで返すのは
// 「ノートの中にある、まだチェックの付いていない項目」であって、タスクの一覧ではない。
// 並べ替え・期限の解釈・外部のタスク管理ツールとの突き合わせは、呼び出す側の AI が行う。
// 項目の本文にリンクがあれば links として返すので、外部ツールの項目との鍵に使える。

import { INDEX_SCHEMA_VERSION, type NoteIndexEntry } from "../features/navigation/index-file";
import { normalizeFolderKey } from "../features/note-context/reserved-folders";
import { allEntries } from "./search";
import { readNoteIndex, resolveGraphiumRoot } from "./vault";

/** 一度に返す項目数の上限（長い出力でモデルの入力を溢れさせない） */
export const DEFAULT_LIMIT = 200;

export type ListTodosOptions = {
  /** このフォルダ（または子フォルダ）のノートだけに絞る */
  folder?: string;
  /** このノートだけに絞る */
  noteId?: string;
  /** チェック済みの項目も含める */
  includeDone?: boolean;
  /** 返す項目数の上限 */
  limit?: number;
};

export type TodoItem = {
  noteId: string;
  blockId: string;
  text: string;
  checked: boolean;
  links?: string[];
};

export type TodoNote = {
  noteId: string;
  title: string;
  modifiedAt: string;
  folders: string[];
  items: TodoItem[];
};

/** フォルダ名が、指定したフォルダ自身か、その子（"親/子"）か */
function isInFolder(folders: string[] | undefined, folder: string): boolean {
  const key = normalizeFolderKey(folder);
  if (!key) return true;
  return (folders ?? []).some((f) => {
    const k = normalizeFolderKey(f);
    return k === key || k.startsWith(`${key}/`);
  });
}

/** 索引から、条件に合うノートとその項目を集める（更新の新しいノートが先、項目は文書順） */
export function collectTodos(opts: ListTodosOptions = {}, root = resolveGraphiumRoot()): TodoNote[] {
  const notes: TodoNote[] = [];
  for (const entry of allEntries(root)) {
    // ナレッジ層のページ（AI が書いたもの）は対象にしない。やることは人のノートに書かれる
    if (entry.source === "ai") continue;
    if (opts.noteId && entry.noteId !== opts.noteId) continue;
    if (opts.folder && !isInFolder(entry.noteContexts, opts.folder)) continue;
    const items = (entry.checklist ?? [])
      .filter((c) => opts.includeDone || !c.checked)
      .map((c) => ({
        noteId: entry.noteId,
        blockId: c.blockId,
        text: c.text,
        checked: c.checked,
        ...(c.links?.length ? { links: c.links } : {}),
      }));
    if (items.length === 0) continue;
    notes.push({
      noteId: entry.noteId,
      title: entry.title || "(untitled)",
      modifiedAt: entry.modifiedAt,
      folders: entry.noteContexts ?? [],
      items,
    });
  }
  notes.sort((a, b) => (b.modifiedAt || "").localeCompare(a.modifiedAt || ""));
  return notes;
}

/** 索引がこの機能より古い版なら、その旨の注意書きを返す */
function staleIndexNotice(root: string): string | null {
  const index = readNoteIndex(root);
  if (!index) return null;
  if (typeof index.version === "number" && index.version < INDEX_SCHEMA_VERSION) {
    return (
      `注意: 索引（note-index.json）が古い版（v${index.version}）です。` +
      `Graphium をこの機能のある版で一度起動すると索引が作り直され、チェックリスト項目が載ります。` +
      `それまでは、この一覧には項目が出ません。`
    );
  }
  return null;
}

/** list_todos の返り値（Markdown テキスト）を組む */
export function listTodos(opts: ListTodosOptions = {}, root = resolveGraphiumRoot()): string {
  const limit = Math.max(1, opts.limit ?? DEFAULT_LIMIT);
  const notes = collectTodos(opts, root);
  const total = notes.reduce((n, note) => n + note.items.length, 0);
  const notice = staleIndexNotice(root);
  const parts: string[] = [];

  if (total === 0) {
    const scope = [
      opts.folder ? `フォルダ「${opts.folder}」` : null,
      opts.noteId ? `ノート ${opts.noteId}` : null,
    ]
      .filter(Boolean)
      .join("・");
    parts.push(
      opts.includeDone
        ? `チェックリスト項目はありません${scope ? `（${scope}）` : ""}。`
        : `まだチェックしていない項目はありません${scope ? `（${scope}）` : ""}。`,
    );
    parts.push(
      "やることはノートの中にチェックリスト（/チェックリスト）として書きます。" +
        "Graphium は期限や優先度を持たないので、並べ替えや期限の解釈はこの会話で行ってください。",
    );
    if (notice) parts.push("", notice);
    return parts.join("\n");
  }

  const heading = opts.includeDone
    ? `# チェックリスト項目（${total} 件・${notes.length} ノート）`
    : `# まだチェックしていない項目（${total} 件・${notes.length} ノート）`;
  parts.push(heading);
  parts.push(
    "項目はノートの中にあるもので、Graphium は期限・優先度・担当を持ちません。" +
      "並べ替えや期限の解釈はこの会話で行ってください。ノートは更新の新しい順、項目はノートの中の順です。",
  );
  if (notice) parts.push("", notice);

  let shown = 0;
  let truncated = false;
  for (const note of notes) {
    if (shown >= limit) {
      truncated = true;
      break;
    }
    const meta = [
      note.folders.length ? `フォルダ: ${note.folders.join(", ")}` : null,
      note.modifiedAt ? `更新: ${note.modifiedAt}` : null,
    ]
      .filter(Boolean)
      .join(" ／ ");
    parts.push("", `## ${note.title}  [noteId: ${note.noteId}]`);
    if (meta) parts.push(meta);
    for (const item of note.items) {
      if (shown >= limit) {
        truncated = true;
        break;
      }
      const links = item.links?.length ? `  → ${item.links.join(" ")}` : "";
      parts.push(`- [${item.checked ? "x" : " "}] ${item.text}  [blockId: ${item.blockId}]${links}`);
      shown++;
    }
  }
  if (truncated) {
    parts.push("", `（${total} 件のうち ${shown} 件を表示。folder や noteId で絞るか、limit を増やしてください）`);
  }
  return parts.join("\n");
}
