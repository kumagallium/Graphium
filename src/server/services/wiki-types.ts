// Wiki パイプラインの共有型
//
// Atomizer / sampling / wiki-service など、複数のサービスが参照する
// 共有型を集約する。Synthesizer 撤退（2026-05-27）前は wiki-synthesizer.ts
// に住んでいたが、Synthesizer 自動生成パイプライン削除に伴い独立ファイルへ移動。

import type {
  AtomType,
  EpistemicStatus,
} from "../../lib/document-types.js";

/**
 * Claim / Atom のスナップショット。
 * Atomizer や sampling など、downstream consumer に渡す前提で構築する。
 */
export type ClaimSnapshot = {
  id: string;
  title: string;
  /**
   * 本文先頭のプレビュー（1ノート1知見前提）。
   * 旧来の sections（見出し + プレビュー配列）から本文プレビュー一本に変更。
   */
  bodyPreview: string;
  /** Claim の抽象度レベル（principle / finding / bridge） */
  level?: "principle" | "finding" | "bridge";
  /** 関連 Claim タイトル */
  relatedClaims: string[];
  /**
   * 上流 Summary のプレビュー（誤差伝搬抑制のため downstream consumer に併読させる）。
   * 空配列でも動作する（後方互換）。
   */
  sourceSummaryPreviews?: { title: string; preview: string }[];
  // PR-B4.5: ClaimSnapshot からも procedureContext を外した。Atomizer に渡しても
  // 下流に持ち越せず、混乱の元になるため。
  // 必要があれば呼び出し側で source Claim から直接取得する。
  /**
   * 入力が Atom の場合の atomType（提案 v4 Phase 1.2）。
   * downstream consumer がモード推定に使う。kind が "claim" の場合は undefined。
   * PR-B5 で追加。
   */
  atomType?: AtomType;
  /**
   * 入力 Atom / Claim の認識論的ステータス（Phase η）。
   * downstream consumer は入力 Atom の epistemicStatus を上流の判断材料として読む。
   * undefined は legacy データで、 "interpretation" として扱う。
   */
  epistemicStatus?: EpistemicStatus;
  /**
   * 反例条件（Toulmin Rebuttal, Phase γ）。
   * Atomizer は「2+ Claim が共通の rebuttal を持つ」ことを判定して Atom 側へ伝播する。
   * 空配列 / undefined は「ノートに rebuttal の記述なし」。
   */
  rebuttalConditions?: string[];
};
