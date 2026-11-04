// 出どころ ID の種類判定（MCP とチャットの道具で共有する。ファイルシステム非依存）

/** 出どころ ID が外部資料（ノートでないもの）か */
export function isExternalSourceId(id: string): boolean {
  return /^(pdf|document|url|chat|memo):/.test(id);
}
