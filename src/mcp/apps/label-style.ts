// 会話の中のプレビューで PROV ラベルを見せるための色と表示名。
//
// プレビューの画面は 1 枚の HTML に閉じて配るので、アプリの i18n 辞書（src/i18n/*.ts）や
// React 部品（context-label/prov-indicator.tsx）をそのまま持ち込むと重くなる。必要な分だけ写す。
// 値の出どころ:
//   - 色: src/features/context-label/prov-indicator.tsx の LABEL_COLORS
//   - 名前: src/i18n/{ja,en}.ts の label.* （label-style.test.ts が食い違いを検出する）

export const LABEL_COLORS: Record<string, string> = {
  procedure: "#5b8fb9",
  material: "#4B7A52",
  tool: "#c08b3e",
  attribute: "#8fa394",
  output: "#c26356",
  result: "#c26356",
};

/** 色の無いラベル（plan・自由ラベル）の色。prov-indicator.tsx のフォールバックと同じ */
export const LABEL_FALLBACK_COLOR = "#6b7280";

/** 内部キー → i18n キー（src/i18n/index.tsx の LABEL_DISPLAY_MAP の括弧なし版） */
export const LABEL_I18N_KEYS: Record<string, string> = {
  procedure: "label.step",
  plan: "label.plan",
  result: "label.result",
  material: "label.material",
  tool: "label.tool",
  attribute: "label.attr",
  output: "label.output",
};

export const LABEL_NAMES: Record<"ja" | "en", Record<string, string>> = {
  ja: {
    procedure: "ステップ",
    plan: "計画",
    result: "結果",
    material: "インプット",
    tool: "ツール",
    attribute: "パラメータ",
    output: "アウトプット",
  },
  en: {
    procedure: "Step",
    plan: "Plan",
    result: "Result",
    material: "Input",
    tool: "Tool",
    attribute: "Parameter",
    output: "Output",
  },
};

export function labelName(label: string, lang: "ja" | "en"): string {
  return LABEL_NAMES[lang][label] ?? label;
}

export function labelColor(label: string): string {
  return LABEL_COLORS[label] ?? LABEL_FALLBACK_COLOR;
}
