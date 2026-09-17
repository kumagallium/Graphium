// 洞察（Atom）の統合 — 点検（wiki-linter）の redundant 検出からユーザーが明示的に選んだ
// 「残す洞察」「まとめる洞察」を、モデルを介さず統合する純粋な実行部分。
//
// Topic の統合（topic-stage.ts の applyTopicMerges）とは以下が異なるため、専用に書く:
// - Topic は「メンバー知見の合流 + 本文の再構成（composeTopicBody）」が中心。
// - Atom は「上流 Claim（derivedFromClaims）・関係（relatedAtoms）・矛盾（conflictsWith）の
//   統合」が中心で、本文は既存の再生成の経路（atomize の re-lift、note-app.tsx の
//   regenerateWikiById）に作り直しを委ねる — compose 相当のロジックをここに複製しない。
//
// 吸収された Atom は物理削除せずアーカイブする（可逆。参照保護のため）。
// 他の Atom の relatedAtoms/conflictsWith に残った吸収側 ID は書き換えない — AtomRelation の
// 型コメントの通り、存在しない/アーカイブ済みの ID は UI 側で「不明」フォールバック済み。

import type { GraphiumDocument, WikiMeta, AtomRelation } from "../../lib/document-types";
import type { EditActivityType } from "../document-provenance/types";

export type MergeAtomsDeps = {
  loadDoc: (noteId: string) => Promise<GraphiumDocument | null>;
  getCachedDoc: (noteId: string) => GraphiumDocument | null | undefined;
  handleSaveWikiFile: (
    wikiId: string,
    doc: GraphiumDocument,
    options?: { activityType?: EditActivityType; agentLabel?: string; sources?: string[] },
  ) => Promise<boolean | void>;
  /** 吸収された洞察をアーカイブする（可逆。既存の handleArchiveWikiFile をそのまま渡す想定） */
  handleArchiveWikiFile: (wikiId: string) => Promise<void>;
  /** 統合後の本文を作り直す（既存の再生成の経路。note-app.tsx の regenerateWikiById を想定） */
  regenerateWiki: (wikiId: string) => Promise<{ ok: boolean; error?: string }>;
  log?: (...args: unknown[]) => void;
};

export type MergeAtomsResult = {
  /** アーカイブした吸収側の件数 */
  merged: number;
  /** 統合後の本文再生成に成功したか */
  regenerated: boolean;
  /** 読み込み・保存・アーカイブ・再生成のいずれかで失敗した件数 */
  failed: number;
};

/**
 * keepId に absorbIds を吸収させる形で洞察（Atom）を統合する。
 * 1. 吸収側の derivedFromClaims / relatedAtoms / conflictsWith を残す側へ合流する
 *    （自分自身・吸収側自身への参照は作らない）。
 * 2. 合流後の wikiMeta で keep を保存する。
 * 3. 吸収側をアーカイブする。
 * 4. keep の本文を既存の再生成経路で作り直す（合流した derivedFromClaims から re-lift）。
 */
export async function mergeAtomsExplicit(
  keepId: string,
  absorbIds: string[],
  deps: MergeAtomsDeps,
): Promise<MergeAtomsResult> {
  const result: MergeAtomsResult = { merged: 0, regenerated: false, failed: 0 };
  const ids = [...new Set(absorbIds)].filter((id) => id !== keepId);
  if (ids.length === 0) return result;
  const log = deps.log ?? (() => {});

  const keepDoc = deps.getCachedDoc(`wiki:${keepId}`) ?? (await deps.loadDoc(`wiki:${keepId}`));
  if (!keepDoc?.wikiMeta || keepDoc.wikiMeta.kind !== "atom") {
    log("洞察の統合: keep 側が Atom ではない、または読み込めない", keepId);
    result.failed++;
    return result;
  }

  const derivedFromClaims = new Set(keepDoc.wikiMeta.derivedFromClaims ?? []);
  const relatedAtomsById = new Map<string, AtomRelation>(
    (keepDoc.wikiMeta.relatedAtoms ?? []).map((r) => [r.atomId, r]),
  );
  const conflictsWith = new Set(keepDoc.wikiMeta.conflictsWith ?? []);
  const absorbedIds = new Set(ids);

  for (const absorbId of ids) {
    try {
      const absorbDoc = deps.getCachedDoc(`wiki:${absorbId}`) ?? (await deps.loadDoc(`wiki:${absorbId}`));
      if (!absorbDoc?.wikiMeta || absorbDoc.wikiMeta.kind !== "atom") {
        log("洞察の統合: 吸収側が Atom ではない、または読み込めない", absorbId);
        result.failed++;
        continue;
      }
      for (const claimId of absorbDoc.wikiMeta.derivedFromClaims ?? []) {
        derivedFromClaims.add(claimId);
      }
      for (const rel of absorbDoc.wikiMeta.relatedAtoms ?? []) {
        // 自分自身（keep）・吸収し合う側どうしへの参照は持たせない
        if (rel.atomId === keepId || absorbedIds.has(rel.atomId)) continue;
        if (!relatedAtomsById.has(rel.atomId)) relatedAtomsById.set(rel.atomId, rel);
      }
      for (const cid of absorbDoc.wikiMeta.conflictsWith ?? []) {
        if (cid === keepId || absorbedIds.has(cid)) continue;
        conflictsWith.add(cid);
      }
    } catch (err) {
      log("洞察の統合: 吸収側の読み込みに失敗", absorbId, err);
      result.failed++;
    }
  }

  // 統合前から自己参照が混入していた場合の保険
  relatedAtomsById.delete(keepId);
  conflictsWith.delete(keepId);

  const nextWikiMeta: WikiMeta = {
    ...keepDoc.wikiMeta,
    derivedFromClaims: [...derivedFromClaims],
    relatedAtoms: relatedAtomsById.size > 0 ? [...relatedAtomsById.values()] : undefined,
    conflictsWith: conflictsWith.size > 0 ? [...conflictsWith] : undefined,
  };

  try {
    await deps.handleSaveWikiFile(keepId, { ...keepDoc, wikiMeta: nextWikiMeta }, {
      activityType: "wiki_dedup_merge",
      sources: ids,
    });
  } catch (err) {
    log("洞察の統合: keep 側の保存に失敗", keepId, err);
    result.failed++;
    return result;
  }

  for (const absorbId of ids) {
    try {
      await deps.handleArchiveWikiFile(absorbId);
      result.merged++;
    } catch (err) {
      log("洞察の統合: 吸収側のアーカイブに失敗", absorbId, err);
      result.failed++;
    }
  }

  // 本文は compose を複製せず、既存の再生成経路（atomize の re-lift）に任せる
  try {
    const regen = await deps.regenerateWiki(keepId);
    result.regenerated = regen.ok;
    if (!regen.ok) {
      log("洞察の統合: 本文の再生成に失敗", keepId, regen.error);
      result.failed++;
    }
  } catch (err) {
    log("洞察の統合: 本文の再生成で例外", keepId, err);
    result.failed++;
  }

  return result;
}
