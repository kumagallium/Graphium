// 来歴・横断の本体（lineage.ts / entities.ts）が使うデータの読み口。
// MCP は vault のファイルを、チャットの道具は noteIndex と doc キャッシュを読む実装を渡す。

import type { GraphiumDocument } from "../../lib/document-types";
import type { NoteIndexEntry } from "../navigation/index-file";

export type ProvGraphReader = {
  /** 検索・横断の対象エントリ（ゴミ箱・アーカイブは除いたもの） */
  entries(): NoteIndexEntry[];
  /** ノート・ナレッジ本体（どちらも素の ID で引く）。無ければ null */
  readNote(noteId: string): GraphiumDocument | null;
  /** 出どころ ID（ノート ID / pdf: / document: / url: など）の表示名 */
  sourceTitle(id: string, titles?: Map<string, string>): string;
};
