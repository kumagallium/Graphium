// ──────────────────────────────────────────────
// テンプレート保存
//
// 現在のページ構造（ブロック + ラベル + 属性）をJSONとして保存する
// ──────────────────────────────────────────────

import type { StepAttributes } from "../context-label/label-attributes";
import type { MediaInlineLabel, TableMeta } from "../../lib/document-types";
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
  /** 表のふるまい（省略可）。空なら書き出さない */
  tableMeta?: Record<string, TableMeta>;
  /** メディアブロックのラベル（省略可）。空なら書き出さない */
  mediaInlineLabels?: Record<string, MediaInlineLabel>;
}): PageTemplate {
  // 空オブジェクトはフィールドごと落とす。なぜ: 旧テンプレート JSON と同じ形を保ち、
  // 「注釈が無い」ことを {} と undefined の 2 通りで表現しないため。
  const hasTableMeta = !!params.tableMeta && Object.keys(params.tableMeta).length > 0;
  const hasMediaLabels =
    !!params.mediaInlineLabels && Object.keys(params.mediaInlineLabels).length > 0;
  return {
    name: params.name,
    savedAt: new Date().toISOString(),
    pageTitle: params.pageTitle,
    blocks: structuredClone(params.blocks),
    labels: structuredClone(params.labels),
    attributes: structuredClone(params.attributes),
    ...(hasTableMeta ? { tableMeta: structuredClone(params.tableMeta!) } : {}),
    ...(hasMediaLabels
      ? { mediaInlineLabels: structuredClone(params.mediaInlineLabels!) }
      : {}),
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
