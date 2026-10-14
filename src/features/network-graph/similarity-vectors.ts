/**
 * 全体グラフの「意味で寄せる」用に、埋め込みストア（IndexedDB）からページごとの
 * ベクトルを 1 本ずつ取り出す。
 *
 * - ベクトルの無いレコード（text-only のフォールバック）は除く
 * - 埋め込みモデルの版が混ざっていたら、最も多い版だけを使う（版違いの cosine は無意味）
 * - 1 ページに複数セクションがあれば "lead" を優先し、無ければ平均する
 */
import { embeddingStore } from "../../lib/embedding-store";

export async function loadSimilarityVectors(): Promise<Map<string, number[]>> {
  const records = (await embeddingStore.getAllRecords()).filter((r) => r.vector && r.vector.length > 0);
  const byVersion = new Map<string, number>();
  for (const r of records) byVersion.set(r.modelVersion, (byVersion.get(r.modelVersion) ?? 0) + 1);
  let dominant = "";
  let best = -1;
  for (const [v, n] of byVersion) {
    if (n > best) {
      best = n;
      dominant = v;
    }
  }
  const lead = new Map<string, number[]>();
  const sums = new Map<string, { sum: number[]; n: number }>();
  for (const r of records) {
    if (r.modelVersion !== dominant) continue;
    if (r.sectionId === "lead") {
      lead.set(r.documentId, r.vector);
      continue;
    }
    const acc = sums.get(r.documentId);
    if (!acc) sums.set(r.documentId, { sum: [...r.vector], n: 1 });
    else if (acc.sum.length === r.vector.length) {
      for (let i = 0; i < acc.sum.length; i++) acc.sum[i] += r.vector[i];
      acc.n++;
    }
  }
  const out = new Map<string, number[]>(lead);
  for (const [id, acc] of sums) {
    if (out.has(id)) continue;
    out.set(id, acc.sum.map((v) => v / acc.n));
  }
  return out;
}
