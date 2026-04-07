// ──────────────────────────────────────────────
// PROV生成時のエラー・警告処理
// thought-provenance-spec.md § 0-F に準拠
// ──────────────────────────────────────────────

export type ProvWarningType =
  | "unknown-label"          // 未知のラベル → Layer 3 扱い
  | "broken-link";           // 前手順リンク先が存在しない

export type ProvWarning = {
  type: ProvWarningType;
  blockId: string;
  message: string;
};

export function createWarning(type: ProvWarningType, blockId: string, message: string): ProvWarning {
  return { type, blockId, message };
}
