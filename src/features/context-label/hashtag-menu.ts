// # をトリガーのオートコンプリートメニュー定義
// BlockNote の SuggestionMenu を使い、インラインでラベル付与する

import {
  CORE_LABELS,
  ALIAS_MAP,
  FREE_LABEL_EXAMPLES,
  normalizeLabel,
  type CoreLabel,
} from "./labels";

// 候補アイテムの型
export type LabelSuggestion = {
  /** 検索対象文字列 */
  query: string;
  /** 内部ラベル名（例: "[使用したもの]"） */
  label: string;
  /** バッジに表示する名前（例: "使用したもの"） */
  displayName: string;
  /** ラベルの種類 */
  group: "core" | "alias" | "free";
};

// バッジ表示名（[] を除いた名前）
export const DISPLAY_NAMES: Record<string, string> = {
  "[手順]": "手順",
  "[材料]": "材料",
  "[ツール]": "ツール",
  "[属性]": "属性",
  "[結果]": "結果",
};

/** 表示名を取得（[] を除去） */
export function getDisplayName(label: string): string {
  return DISPLAY_NAMES[label] ?? label.replace(/^\[|\]$/g, "");
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
    const displayName = label.replace(/^\[|\]$/g, "");
    suggestions.push({
      query: displayName,
      label,
      displayName,
      group: "free",
    });
  }

  return suggestions;
}
