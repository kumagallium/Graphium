// 出典照合（Source check, v1） — 判定結果をプロバイダへ保存する呼び出し用の入口。
//
// 既存の世界照合の実行経路（note-app.tsx の handleWorldCheckWiki）に倣う:
//   1. キャッシュ優先でドキュメントを読む
//   2. attachSourceCheck（書き込み口 1 本）で wikiMeta.sourceCheck だけ差し替える
//   3. activityType 無しで handleSaveWikiFile 相当を呼ぶ（document-provenance に
//      phantom revision を作らない — 判定しても自動で編集扱いにしない、仕様の不変条件 5）
//   4. 開いているノートなら再同期する（activeDoc は保存では更新されないため）
//
// UI（実行ボタン・確認ダイアログ）は本タスクのスコープ外。note-app.tsx からこの関数を
// 呼び出す配線は次の担当が行う。

import type { GraphiumDocument, SourceCheckProfile } from "../../lib/document-types";
import { attachSourceCheck } from "./attach";

export type SaveSourceCheckDeps = {
  getCachedDoc: (id: string) => GraphiumDocument | undefined;
  loadDoc: (id: string) => Promise<GraphiumDocument | null>;
  /** fm.handleSaveWikiFile 相当。options（activityType 等）は渡さない */
  saveWikiFile: (wikiId: string, doc: GraphiumDocument) => Promise<unknown>;
  /** 現在開いているファイル ID（"wiki:<id>" 形式）。省略時は再同期しない */
  activeFileId?: string | null;
  /** activeFileId が対象なら呼ぶ（fm.handleOpenWikiFile 相当の再読み込み） */
  reopenActiveWikiFile?: (wikiId: string) => void;
};

/** 1 件の知見に判定結果を保存する */
export async function saveSourceCheckResult(
  wikiId: string,
  profile: SourceCheckProfile,
  deps: SaveSourceCheckDeps,
): Promise<void> {
  const cached = deps.getCachedDoc(`wiki:${wikiId}`);
  const doc = cached ?? (await deps.loadDoc(`wiki:${wikiId}`));
  if (!doc?.wikiMeta) return;
  const next: GraphiumDocument = {
    ...attachSourceCheck(doc, profile),
    modifiedAt: new Date().toISOString(),
  };
  await deps.saveWikiFile(wikiId, next);
  if (deps.activeFileId === `wiki:${wikiId}`) {
    deps.reopenActiveWikiFile?.(wikiId);
  }
}

/** runSourceCheck の結果（claimId → profile）をまとめて保存する */
export async function saveSourceCheckResults(
  profiles: Map<string, SourceCheckProfile>,
  deps: SaveSourceCheckDeps,
): Promise<void> {
  for (const [wikiId, profile] of profiles) {
    await saveSourceCheckResult(wikiId, profile, deps);
  }
}
