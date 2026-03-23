// ──────────────────────────────────────────────
// ラベル連動属性の定義
//
// ラベルごとに追加表示される属性を定義する。
// 例: [手順] → チェック（完了）/ 実行者タイプ / ステータス
// ──────────────────────────────────────────────

// 実行者タイプ（誰/何がこの手順を実行するか）
export type ExecutorType = "human" | "machine" | "ai";

// ステータス（手順の進行状態）
export type StepStatus = "planned" | "in-progress" | "done" | "skipped";

// [手順] ラベルの連動属性
export type StepAttributes = {
  checked: boolean;
  executor: ExecutorType;
  status: StepStatus;
};

// ラベルごとの属性マップ（拡張可能）
export type LabelAttributes = {
  "[手順]": StepAttributes;
};

// デフォルト値
export const DEFAULT_STEP_ATTRIBUTES: StepAttributes = {
  checked: false,
  executor: "human",
  status: "planned",
};

// ラベルが連動属性を持つかどうか
export function hasLabelAttributes(label: string): label is keyof LabelAttributes {
  return label === "[手順]";
}

// 実行者タイプの表示名
export const EXECUTOR_LABELS: Record<ExecutorType, string> = {
  human: "手動",
  machine: "装置",
  ai: "AI",
};

// ステータスの表示名と色
export const STATUS_CONFIG: Record<StepStatus, { label: string; color: string }> = {
  planned: { label: "予定", color: "#6b7280" },
  "in-progress": { label: "実行中", color: "#5b8fb9" },
  done: { label: "完了", color: "#4B7A52" },
  skipped: { label: "スキップ", color: "#9ca3af" },
};
