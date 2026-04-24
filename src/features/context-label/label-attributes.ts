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
  procedure: StepAttributes;
};

// デフォルト値
export const DEFAULT_STEP_ATTRIBUTES: StepAttributes = {
  checked: false,
  executor: "human",
  status: "planned",
};

// ラベルが連動属性を持つかどうか
export function hasLabelAttributes(label: string): label is keyof LabelAttributes {
  return label === "procedure";
}

import { t } from "../../i18n";

// 実行者タイプの表示名（i18n 対応）
export function getExecutorLabel(executor: ExecutorType): string {
  const key = `executor.${executor}`;
  return t(key);
}

// ステータスの色（言語非依存）
export const STATUS_COLORS: Record<StepStatus, string> = {
  planned: "#6b7280",
  "in-progress": "#5b8fb9",
  done: "#4B7A52",
  skipped: "#9ca3af",
};

// ステータスの表示名（i18n 対応）
export function getStatusLabel(status: StepStatus): string {
  const keyMap: Record<StepStatus, string> = {
    planned: "status.planned",
    "in-progress": "status.inProgress",
    done: "status.done",
    skipped: "status.skipped",
  };
  return t(keyMap[status]);
}

// ステータスの表示名と色（互換用）
export function getStatusConfig(status: StepStatus): { label: string; color: string } {
  return { label: getStatusLabel(status), color: STATUS_COLORS[status] };
}

// 後方互換: 既存コードが EXECUTOR_LABELS, STATUS_CONFIG を参照している場合
// NOTE: これらは呼び出し時の locale で解決されるため、静的な定数ではない
export const EXECUTOR_LABELS: Record<ExecutorType, string> = new Proxy(
  {} as Record<ExecutorType, string>,
  { get: (_, key: string) => getExecutorLabel(key as ExecutorType) },
);

export const STATUS_CONFIG: Record<StepStatus, { label: string; color: string }> = new Proxy(
  {} as Record<StepStatus, { label: string; color: string }>,
  { get: (_, key: string) => getStatusConfig(key as StepStatus) },
);
