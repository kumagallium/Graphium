// ベクトル演算ユーティリティ

/**
 * コサイン類似度を計算する。
 *
 * 生の cosine は -1..1 の範囲を取る。`clamp` が true の場合は 0..1 に丸める
 * （embedding 類似度用途で負の相関を 0 として扱いたいケース向け）。
 * `clamp` が false（デフォルト）の場合は生の値をそのまま返す。
 *
 * 次元が一致しない、または空配列の場合は 0 を返す。
 */
export function cosineSimilarity(a: number[], b: number[], clamp = false): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  const raw = denom === 0 ? 0 : dot / denom;
  return clamp ? Math.max(0, Math.min(1, raw)) : raw;
}
