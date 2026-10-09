// 「構造」節（判断・規則・観察の frame）の表示ロジック。純関数のみ（React 非依存）。
// 設計: docs/internal/judgment-rule-frames-design-2026-10.md §3

import type { FrameComparator, FrameValue, WikiMeta, WikiMetaSummary } from "../../lib/document-types";
import { isRegularNoteId } from "./rationale-write";

/** 記号で書ける比較子。それ以外は i18n の短い語にする */
const COMPARATOR_SYMBOLS: Partial<Record<FrameComparator, string>> = {
  eq: "=",
  lt: "<",
  gt: ">",
  le: "≤",
  ge: "≥",
};

/** 比較子の表示。記号があれば記号、無ければ label(key) の短い語 */
export function comparatorLabel(
  comparator: FrameComparator,
  label: (key: `wiki.frame.comparator.${FrameComparator}`) => string,
): string {
  return COMPARATOR_SYMBOLS[comparator] ?? label(`wiki.frame.comparator.${comparator}`);
}

/** FrameValue を 1 行にする: 「item comparator value unit」（無い欄は飛ばす） */
export function formatFrameValue(
  v: FrameValue,
  label: (key: `wiki.frame.comparator.${FrameComparator}`) => string,
): string {
  const parts: string[] = [v.item];
  if (v.comparator) parts.push(comparatorLabel(v.comparator, label));
  if (v.value !== undefined && v.value !== "") parts.push(String(v.value));
  if (v.unit) parts.push(v.unit);
  return parts.join(" ");
}

export type FrameClaimLink = {
  id: string;
  /** 表示名。解決できなければ空文字（呼び出し側が t("wiki.frame.unknownClaim") を出す） */
  label: string;
  resolved: boolean;
  /** onNavigateNote に渡す id（wiki: 付き）。解決できなければ空 */
  navigateId: string;
};

/** 知見 id 列をタイトル付きリンクに解決する（重複は 1 件、解決できなければ label 空の無効リンク） */
export function resolveFrameClaimLinks(
  ids: readonly string[] | undefined,
  allWikiMetas: Map<string, WikiMetaSummary> | undefined,
): FrameClaimLink[] {
  if (!ids) return [];
  const seen = new Set<string>();
  const out: FrameClaimLink[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const m = allWikiMetas?.get(id);
    out.push(
      m
        ? { id, label: m.title || id, resolved: true, navigateId: `wiki:${id}` }
        : { id, label: "", resolved: false, navigateId: "" },
    );
  }
  return out;
}

/** frame が 1 つでもあるか（asterism は PR 4 で扱うので見ない） */
export function hasFrameToShow(meta: WikiMeta): boolean {
  return !!(meta.decisionFrame || meta.ruleFrame || meta.observationFrame);
}

/** 「理由を書く」を出してよいか: 理由が null で、通常ノート出典を持つ判断 */
export function canWriteRationale(meta: WikiMeta): boolean {
  const f = meta.decisionFrame;
  if (!f || f.rationale !== null) return false;
  return (meta.derivedFromNotes ?? []).some(isRegularNoteId);
}

/** 確認待ち（いずれかの frame が inferred）か */
export function hasInferredFrame(meta: WikiMeta): boolean {
  return (
    meta.decisionFrame?.reviewState === "inferred" ||
    meta.ruleFrame?.reviewState === "inferred" ||
    meta.observationFrame?.reviewState === "inferred"
  );
}
