// ──────────────────────────────────────────────
// パターン分岐展開ロジック
//
// [試料] テーブルの行数分だけ Activity を複製し、
// 各パターン固有の条件を Entity として生成する。
// 後続ステップへの伝播は informed_by リンク経由で制御する。
// ──────────────────────────────────────────────

import type { SampleRow, SampleTable } from "./parser";
import type { BlockLink } from "../block-link/link-types";

/** PROV上の Activity（手順）を表現 */
export type ProvActivity = {
  id: string;
  label: string;
  /** 元のブロックID */
  blockId: string;
  /** パターンIDで分岐した場合のパターンID（未分岐なら undefined） */
  sampleId?: string;
};

/** PROV上の Entity（試料・材料・結果など）を表現 */
export type ProvEntity = {
  id: string;
  label: string;
  blockId: string;
  sampleId?: string;
  params?: Record<string, string>;
};

/** 分岐展開の結果 */
export type BranchExpansion = {
  /** 分岐元の Activity ブロックID */
  sourceBlockId: string;
  /** 展開された Activity 群 */
  activities: ProvActivity[];
  /** 展開された Entity 群（パターンごとの条件） */
  entities: ProvEntity[];
};

/**
 * [試料] テーブルから Activity を分岐展開する
 *
 * 例: 3パターンのテーブル → 3つの Activity と 3つの Entity
 */
export function expandSampleBranch(
  activityBlockId: string,
  activityLabel: string,
  sampleTable: SampleTable,
): BranchExpansion {
  const activities: ProvActivity[] = [];
  const entities: ProvEntity[] = [];

  for (const row of sampleTable.rows) {
    // Activity × N: 各パターンに対して Activity を生成
    const actId = `${activityBlockId}__sample_${row.sampleId}`;
    activities.push({
      id: actId,
      label: `${activityLabel} [${row.sampleId}]`,
      blockId: activityBlockId,
      sampleId: row.sampleId,
    });

    // 試料 Entity を生成
    entities.push({
      id: `entity_${sampleTable.blockId}_${row.sampleId}`,
      label: row.sampleId,
      blockId: sampleTable.blockId,
      sampleId: row.sampleId,
      params: row.params,
    });
  }

  return {
    sourceBlockId: activityBlockId,
    activities,
    entities,
  };
}

/**
 * 後続ステップへの伝播
 *
 * informed_by リンクで前ステップを参照している Activity が、
 * 前ステップでパターン分岐されている場合、
 * 後続ステップも同じ試料分だけ分岐する。
 */
export function propagateBranches(
  /** 後続ステップのブロックID */
  targetBlockId: string,
  /** 後続ステップのラベル */
  targetLabel: string,
  /** informed_by リンク一覧 */
  informedByLinks: BlockLink[],
  /** ブロックID → 分岐展開結果 のマップ */
  branchMap: Map<string, BranchExpansion>,
): BranchExpansion | null {
  // informed_by リンク先の分岐を探す
  for (const link of informedByLinks) {
    const branch = branchMap.get(link.targetBlockId);
    if (branch && branch.activities.length > 1) {
      // 前ステップが分岐している → 同数だけ分岐
      const activities: ProvActivity[] = branch.activities.map((prevAct) => ({
        id: `${targetBlockId}__sample_${prevAct.sampleId}`,
        label: `${targetLabel} [${prevAct.sampleId}]`,
        blockId: targetBlockId,
        sampleId: prevAct.sampleId,
      }));

      return {
        sourceBlockId: targetBlockId,
        activities,
        entities: [], // 後続ステップは自前の Entity を持たない（前ステップから継承）
      };
    }
  }

  return null;
}
