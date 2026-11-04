// 空フォルダ定義（appdata の folders）の保存形式。
//
// 読み書きは folder-store.ts（ストレージプロバイダ経由）が持つ。形式だけをここに分けているのは、
// MCP サーバー（src/mcp/folders.ts）がプロバイダ層（React 側の状態に依存）を import せずに
// 同じファイルを読めるようにするため。

/** 保存形式の版。形が変わったら上げる → 読み込み時に全破棄（空フォルダ定義は失っても軽傷） */
export const FOLDER_DEFS_VERSION = 1;

export type FolderDefinitionsFile = {
  version: number;
  /** ユーザーが作成したフォルダの path（"親" または "親/子"）。表記は作成時のまま保持 */
  folders: string[];
};
