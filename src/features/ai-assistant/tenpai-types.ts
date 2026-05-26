// 聴牌（tenpai）hint レイヤの型定義（2026-05-23）。
//
// 「もうすぐ揃いそうな考察」を AI 側から半能動に提案するためのデータ構造。
// AI インタラクションの 3 層構造（feed / 聴牌 / Command+K）における中間層。
//
// 設計判断:
// - hint 本体は永続化しない（atom 状態から都度生成）。AI Wiki cycle と同じく
//   「保存より再生成を優先」の哲学に沿う
// - dismiss のみ localStorage に永続化（再表示抑制の負シグナル）
// - cooldown は ISO 8601 文字列で持つ。デフォルト 7 日

import type { SynthesisMode } from "../../lib/document-types.js";

/** 「あと何が必要か」の構造化判定（router → i18n key 変換用） */
export type TenpaiMissingReason =
  | { kind: "one-more-causal" }
  | { kind: "need-mechanism" }
  | { kind: "one-more-mechanism" };

/** 「もうすぐ揃いそう」な合成モードとユーザー提示用メッセージ */
export type TenpaiHint = {
  /** hash(mode + sorted(involvedAtomIds))。dismiss の cooldown キー */
  id: string;
  mode: SynthesisMode;
  /** 何が欠けているかの i18n key（例: "tenpai.missing.dialectic.one-more-causal"） */
  missingKey: string;
  /** プレビュー用：hint の根拠 atom（id とタイトル） */
  involvedAtoms: Array<{ id: string; title: string }>;
  /** ISO 8601 文字列 */
  generatedAt: string;
};

/** dismiss された hint の cooldown 期限 */
export type TenpaiDismissal = {
  id: string;
  /** ISO 8601 文字列。この時刻まで同じ hint は表示しない */
  dismissedUntil: string;
};

/** localStorage キー */
export const TENPAI_DISMISSED_STORAGE_KEY = "graphium-tenpai-dismissed";

/** dismiss のデフォルト cooldown 日数 */
export const TENPAI_DEFAULT_COOLDOWN_DAYS = 7;

/**
 * 聴牌計算を発火する atom 数の最低閾値。
 * 6 件未満では「揃いそう」判定の意味が薄いので無音化する。
 */
export const TENPAI_MIN_ATOM_COUNT = 6;

/** TenpaiMissingReason を i18n key 文字列に変換 */
export function tenpaiMissingKeyOf(mode: SynthesisMode, missing: TenpaiMissingReason): string {
  return `tenpai.missing.${mode}.${missing.kind}`;
}

/**
 * hint の id を生成（同一シグナルの cooldown キーとして使う）。
 * 同じ atom 群 + 同じモードなら同じ id になる。
 */
export function tenpaiHintIdOf(mode: SynthesisMode, atomIds: string[]): string {
  const sorted = [...atomIds].sort();
  return `${mode}:${sorted.join(",")}`;
}
