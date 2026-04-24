// # をトリガーのオートコンプリートメニュー定義
// BlockNote の SuggestionMenu を使い、インラインでラベル付与する

import {
  CORE_LABELS,
  ALIAS_MAP,
  FREE_LABEL_EXAMPLES,
  normalizeLabel,
  type CoreLabel,
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
