// ──────────────────────────────────────────────
// テンプレートの型定義
// ──────────────────────────────────────────────

import type { StepAttributes } from "../context-label/label-attributes";

// テンプレートとして保存されるページのスナップショット
export type PageTemplate = {
  /** テンプレート名 */
  name: string;
  /** 保存日時（ISO文字列） */
  savedAt: string;
  /** ページタイトル */
  pageTitle: string;
  /** BlockNoteのブロックJSON */
  blocks: any[];
  /** blockId → ラベル文字列 */
  labels: [string, string][];
  /** blockId → 連動属性 */
  attributes: [string, StepAttributes][];
};

// テンプレートストアに保存される形式
export type TemplateEntry = {
  id: string;
  template: PageTemplate;
};
