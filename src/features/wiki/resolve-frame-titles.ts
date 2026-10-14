// 判断フレームの title → id 解決（保存ループの 2 パス目）。
// 仕様: docs/internal/handoff_to_claude_code_judgment_rule_frames.md §5.3

import type { GraphiumDocument } from "../../lib/document-types";
import type { IngesterOutput } from "../../server/services/wiki-ingester";

type TitleId = { title: string; id: string };

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Ingester 出力の triggerTitles / rationaleRuleTitles を id に解決する。
 * created（同一抽出の兄弟）→ existing の順で引く。解決できない title は捨て、重複は除く。
 */
export function resolveFrameTitles(
  ingested: IngesterOutput,
  created: TitleId[],
  existing?: TitleId[],
  /** 対象知見自身の id（自己参照は除外する） */
  selfId?: string,
): { triggerClaimIds: string[]; rationaleRuleIds: string[] } {
  const map = new Map<string, string>();
  // 先に existing、後から created で上書きして created を優先する
  for (const e of existing ?? []) map.set(norm(e.title), e.id);
  for (const c of created) map.set(norm(c.title), c.id);
  const resolve = (titles: string[] | undefined): string[] => {
    const ids: string[] = [];
    for (const t of titles ?? []) {
      const id = map.get(norm(t));
      if (id && id !== selfId && !ids.includes(id)) ids.push(id);
    }
    return ids;
  };
  return {
    triggerClaimIds: resolve(ingested.decisionFrame?.triggerTitles),
    rationaleRuleIds: resolve(ingested.decisionFrame?.rationaleRuleTitles),
  };
}

/** 2 パス目に必要な fm の最小面（テストしやすいよう構造的に絞る） */
type FrameResolveFm = {
  getCachedDoc: (noteId: string) => GraphiumDocument | undefined;
  handleSaveWikiFile: (wikiId: string, doc: GraphiumDocument) => Promise<boolean>;
};

/**
 * 保存ループの 2 パス目: 保存した知見（Ingester 出力と確定 id の組）から判断フレームの
 * triggerClaimIds / rationaleRuleIds を解決し、キャッシュ上の doc に書き戻す。
 * 来歴の二重記録を避けるため activityType なしで保存し、保存中（false）なら 300ms 間隔で最大 3 回再試行する。
 * 解決結果が空の知見や、確認済みで既に値がある欄は触らない。失敗しても取り込み全体は止めない。
 */
export async function applyFrameTitleResolution(
  fm: FrameResolveFm,
  saved: { wiki: IngesterOutput; id: string }[],
  existing?: TitleId[],
): Promise<void> {
  const created = saved.map((s) => ({ title: s.wiki.title, id: s.id }));
  for (const { wiki, id } of saved) {
    if (!wiki.decisionFrame) continue;
    try {
      const resolved = resolveFrameTitles(wiki, created, existing, id);
      if (resolved.triggerClaimIds.length === 0 && resolved.rationaleRuleIds.length === 0) continue;
      const doc = fm.getCachedDoc(`wiki:${id}`);
      const frame = doc?.wikiMeta?.decisionFrame;
      if (!doc?.wikiMeta || !frame) continue;
      const keep = frame.reviewState === "confirmed";
      const nextFrame = {
        ...frame,
        triggerClaimIds:
          resolved.triggerClaimIds.length > 0 && !(keep && frame.triggerClaimIds.length > 0)
            ? resolved.triggerClaimIds
            : frame.triggerClaimIds,
        rationaleRuleIds:
          resolved.rationaleRuleIds.length > 0 && !(keep && (frame.rationaleRuleIds?.length ?? 0) > 0)
            ? resolved.rationaleRuleIds
            : frame.rationaleRuleIds,
      };
      const nextDoc: GraphiumDocument = { ...doc, wikiMeta: { ...doc.wikiMeta, decisionFrame: nextFrame } };
      let ok = await fm.handleSaveWikiFile(id, nextDoc);
      // 保存中などで false が返ったら 300ms 待って最大 3 回まで再試行する
      for (let retry = 0; !ok && retry < 3; retry++) {
        await new Promise((r) => setTimeout(r, 300));
        ok = await fm.handleSaveWikiFile(id, nextDoc);
      }
      if (!ok) console.warn(`[wiki] id 解決結果を保存できなかった: ${id}`);
    } catch (err) {
      console.warn("[wiki] frame title resolution failed:", err);
    }
  }
}
