// ──────────────────────────────────────────────
// テンプレートの型定義
// ──────────────────────────────────────────────

import type { StepAttributes } from "../context-label/label-attributes";
import type { MediaInlineLabel, TableMeta } from "../../lib/document-types";

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
  /**
   * blockId → テーブル注釈（表の名前・列のふるまい）。
   * なぜ optional: ブロック JSON だけでは「この列は日時が自動で入る」「この列から
   * ノートを作れる」という表のふるまいが落ちる。雛形として使うときに一番効く情報なので
   * 残す。追加のみなので、このフィールドを持たない旧テンプレート JSON もそのまま読める。
   */
  tableMeta?: Record<string, TableMeta>;
  /**
   * blockId → メディアブロックのインラインラベル。
   * 画像・PDF 等は本文にラベルを埋められず別層で持つため、labels と同じ理由でここに残す。
   * こちらも additive optional。
   */
  mediaInlineLabels?: Record<string, MediaInlineLabel>;
};

// テンプレートストアに保存される形式
export type TemplateEntry = {
  id: string;
  template: PageTemplate;
};
