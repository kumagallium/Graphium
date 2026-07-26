// # をトリガーのオートコンプリートメニュー定義
// BlockNote の SuggestionMenu を使い、インラインでラベル付与する

import {
  CORE_LABELS,
  ALIAS_MAP,
  FREE_LABEL_EXAMPLES,
  LABEL_SCOPE,
  getLabelScope,
  type CoreLabel,
  type LabelScope,
} from "./labels";
import { getDisplayLabelName } from "../../i18n";

// 候補アイテムの型
export type LabelSuggestion = {
  /** 検索対象文字列 */
  query: string;
  /** 内部ラベル名（例: "material"） */
  label: string;
  /** バッジに表示する名前（例: "インプット"） */
  displayName: string;
  /** ラベルの種類 */
  group: "core" | "alias" | "free";
};

/** 表示名を取得（i18n 経由、[] を除去） */
export function getDisplayName(label: string): string {
  return getDisplayLabelName(label);
}

/** 候補リストを構築 */
export function buildSuggestionList(): LabelSuggestion[] {
  const suggestions: LabelSuggestion[] = [];

  // コアラベル
  for (const label of CORE_LABELS) {
    const displayName = getDisplayName(label);
    suggestions.push({
      query: displayName,
      label,
      displayName,
      group: "core",
    });
  }

  // エイリアス（正規化先のコアラベルも表示）
  for (const [alias, coreLabel] of Object.entries(ALIAS_MAP)) {
    const aliasDisplay = alias.replace(/^\[|\]$/g, "");
    const coreDisplay = getDisplayName(coreLabel);
    suggestions.push({
      query: aliasDisplay,
      label: coreLabel,
      displayName: `${aliasDisplay} → ${coreDisplay}`,
      group: "alias",
    });
  }

  // フリーラベル例
  for (const label of FREE_LABEL_EXAMPLES) {
    const displayName = getDisplayName(label);
    suggestions.push({
      query: displayName,
      label,
      displayName,
      group: "free",
    });
  }

  return suggestions;
}

/**
 * BlockNote のブロックタイプから、許可される LabelScope セットを返す。
 * - 見出しブロック（heading）: section / phase スコープのラベルが付与可能
 * - step の中の本文ブロック: phase のみ（計画/結果のモード帯の開始マーカー）。
 *   工程そのものは step ブロックが表すので section は出さない。
 * - それ以外（paragraph, bulletListItem, etc.）: free ラベルのみ付与可能
 *   （inline 系ラベルはハイライト経路で付ける、Phase C 以降）
 */
export function getAllowedScopesForBlock(
  blockType: string | undefined,
  insideStep = false,
): Set<LabelScope> {
  if (blockType === "heading") {
    return new Set<LabelScope>(["section", "phase"]);
  }
  if (insideStep && blockType !== "step") {
    return new Set<LabelScope>(["phase"]);
  }
  // 本文ブロックでは inline 系ラベルを `#` 経由で付与しない（ハイライトに移行）
  return new Set<LabelScope>();
}

/**
 * ブロックの種類に応じて候補をフィルタする。
 * Phase B (2026-04-29) で導入した context filter:
 *   - 見出しブロック: section / phase の core/alias を表示
 *   - 本文ブロック: free ラベルのみ表示（inline 系は出さない）
 */
export function filterSuggestionsForBlock(
  suggestions: LabelSuggestion[],
  blockType: string | undefined,
  insideStep = false,
): LabelSuggestion[] {
  const allowedScopes = getAllowedScopesForBlock(blockType, insideStep);

  return suggestions.filter((s) => {
    // free ラベルは常に表示（PROV に乗らないラベル、ユーザー定義）
    if (s.group === "free") return true;

    // core / alias は LABEL_SCOPE で判定
    const scope = s.group === "core"
      ? LABEL_SCOPE[s.label as CoreLabel]
      : getLabelScope(s.label);

    if (!scope) return false;
    return allowedScopes.has(scope);
  });
}
