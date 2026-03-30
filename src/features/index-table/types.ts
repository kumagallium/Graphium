// インデックステーブルの型定義

// サンプル名 → ノートファイル ID のマッピング
// 行インデックスではなくサンプル名をキーにすることで、行の挿入・削除に強い
export type LinkedNotesMap = Record<string, string>;

// JSON 文字列から LinkedNotesMap をパースする
export function parseLinkedNotes(json: string): LinkedNotesMap {
  try {
    return JSON.parse(json) as LinkedNotesMap;
  } catch {
    return {};
  }
}
