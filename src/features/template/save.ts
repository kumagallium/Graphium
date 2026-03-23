// ──────────────────────────────────────────────
// テンプレート保存
//
// 現在のページ構造（ブロック + ラベル + 属性）をJSONとして保存する
// ──────────────────────────────────────────────

import type { StepAttributes } from "../context-label/label-attributes";
import type { PageTemplate } from "./types";

/**
 * エディタの現在状態からテンプレートを生成する
 */
export function createTemplate(params: {
  name: string;
  pageTitle: string;
  blocks: any[];
  labels: [string, string][];
  attributes: [string, StepAttributes][];
}): PageTemplate {
  return {
    name: params.name,
    savedAt: new Date().toISOString(),
    pageTitle: params.pageTitle,
    blocks: structuredClone(params.blocks),
    labels: structuredClone(params.labels),
    attributes: structuredClone(params.attributes),
  };
}

/**
 * テンプレートをJSON文字列にシリアライズ
 */
export function serializeTemplate(template: PageTemplate): string {
  return JSON.stringify(template, null, 2);
}

/**
 * JSON文字列からテンプレートをデシリアライズ
 */
export function deserializeTemplate(json: string): PageTemplate {
  return JSON.parse(json) as PageTemplate;
}
