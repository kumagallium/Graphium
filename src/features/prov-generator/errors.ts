// ──────────────────────────────────────────────
// PROV生成時のエラー・警告処理
// thought-provenance-spec.md § 0-F に準拠
// ──────────────────────────────────────────────

export type ProvWarningType =
  | "unknown-label"          // 未知のラベル → Layer 3 扱い
  | "broken-link"            // 前手順リンク先が存在しない
  | "empty-sample-table"     // [試料] テーブルが空
  | "sample-id-mismatch"     // [結果] の試料IDが [試料] と不一致
  | "sample-condition-coexist"; // 同じH2内に [試料] と [条件] が両方

export type ProvWarning = {
  type: ProvWarningType;
  blockId: string;
  message: string;
};

export function createWarning(type: ProvWarningType, blockId: string, message: string): ProvWarning {
  return { type, blockId, message };
}
