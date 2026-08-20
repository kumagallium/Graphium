// ──────────────────────────────────────────────
// 保存済みノート（GraphiumPage）→ generateProvDocument の入力への変換。
//
// エディタが開いていない状態で PROV を投影する経路（Wiki 生成のノートサマリ、
// プロセスインデックス）が共通で使う。ラベル解釈をそれぞれで書き直すと
// 投影結果が経路ごとにずれるので、変換はここ 1 箇所に集約する。
// ──────────────────────────────────────────────

import type { GraphiumPage } from "../../lib/document-types";
import type { GeneratorInput } from "./generator";

/** blockId → ラベル文字列（空文字は落とす） */
export function toLabelsMap(page: GraphiumPage): Map<string, string> {
  const map = new Map<string, string>();
  for (const [blockId, label] of Object.entries(page.labels ?? {})) {
    if (typeof label === "string" && label.length > 0) map.set(blockId, label);
  }
  return map;
}

/**
 * PROV 層のリンクを集める。
 * legacy v1 の `page.links` も混ぜて渡す（generateProvDocument 内で PROV 層のみ残る）。
 */
export function collectPageLinks(page: GraphiumPage): any[] {
  const links: any[] = [];
  if (Array.isArray(page.provLinks)) links.push(...page.provLinks);
  if (Array.isArray(page.links)) links.push(...page.links);
  return links;
}

/** メディアブロックのインラインラベル（サイドストア）を Map に変換する */
export function toMediaInlineLabelsMap(
  page: GraphiumPage,
): Map<string, { label: "material" | "tool" | "attribute" | "output"; entityId: string }> | undefined {
  const raw = page.mediaInlineLabels;
  if (!raw) return undefined;
  const map = new Map<string, { label: "material" | "tool" | "attribute" | "output"; entityId: string }>();
  for (const [blockId, entry] of Object.entries(raw)) {
    if (entry && entry.label && entry.entityId) {
      map.set(blockId, { label: entry.label, entityId: entry.entityId });
    }
  }
  return map.size > 0 ? map : undefined;
}

/** ページ 1 枚分の generateProvDocument 入力を組み立てる */
export function pageToGeneratorInput(page: GraphiumPage): GeneratorInput {
  return {
    blocks: page.blocks ?? [],
    labels: toLabelsMap(page),
    links: collectPageLinks(page),
    mediaInlineLabels: toMediaInlineLabelsMap(page),
  };
}
