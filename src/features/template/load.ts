// ──────────────────────────────────────────────
// テンプレート読み込み
//
// JSONからページを復元する
// ──────────────────────────────────────────────

import type { StepAttributes } from "../context-label/label-attributes";
import type { PageTemplate } from "./types";

/**
 * テンプレートからエディタの初期コンテンツを取得
 */
export function getTemplateBlocks(template: PageTemplate): any[] {
  return structuredClone(template.blocks);
}

/**
 * テンプレートからラベルストアのスナップショットを取得
 */
export function getTemplateLabelSnapshot(template: PageTemplate): {
  labels: [string, string][];
  attributes: [string, StepAttributes][];
} {
  return {
    labels: structuredClone(template.labels),
    attributes: structuredClone(template.attributes),
  };
}
