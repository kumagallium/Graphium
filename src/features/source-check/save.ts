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
import { saveWikiWithRetry } from "../wiki/claim-topic-link";
import { attachSourceCheck } from "./attach";

export type SaveSourceCheckDeps = {
  getCachedDoc: (id: string) => GraphiumDocument | undefined;
  loadDoc: (id: string) => Promise<GraphiumDocument | null>;
  /**
   * fm.handleSaveWikiFile 相当。options（activityType 等）は渡さない。
   * ほかの保存の最中は書かずに false を返す（その場合は待ってやり直す）
   */
  saveWikiFile: (wikiId: string, doc: GraphiumDocument) => Promise<boolean | void>;
  /** 現在開いているファイル ID（"wiki:<id>" 形式）。省略時は再同期しない */
  activeFileId?: string | null;
  /** activeFileId が対象なら呼ぶ（fm.handleOpenWikiFile 相当の再読み込み） */
  reopenActiveWikiFile?: (wikiId: string) => void;
  /** 断られたときに待つ間隔の基準（ミリ秒）。テスト用 */
  retryDelayMs?: number;
};

/**
 * 1 件の知見の照合の判定を書き換えて保存する（結果の保存・確認済みの反転・消去の共通の口）。
 *
 * handleSaveWikiFile は、ほかの保存の最中だと書かずに false を返す。ページを開いた直後は
 * エディタの保存と重なりやすく、以前はその false を無視していたので、照合の結果が
 * 黙って消えていた。断られたら待ってやり直し、やり直すたびに最新の文書から作り直す
 * （待つあいだのエディタの保存を巻き戻さないため）。最後まで書けなければ例外にする。
 *
 * change が null を返したら書く必要が無いので書かない。戻り値は書いたかどうか。
 */
export async function saveSourceCheckChange(
  wikiId: string,
  change: (doc: GraphiumDocument) => GraphiumDocument | null,
  deps: SaveSourceCheckDeps,
): Promise<boolean> {
  const key = `wiki:${wikiId}`;
  const outcome = await saveWikiWithRetry(
    deps.saveWikiFile,
    wikiId,
    async () => {
      const doc = deps.getCachedDoc(key) ?? (await deps.loadDoc(key));
      if (!doc?.wikiMeta) return null;
      const next = change(doc);
      return next ? { ...next, modifiedAt: new Date().toISOString() } : null;
    },
    deps.retryDelayMs,
  );
  if (outcome === "failed") throw new Error(`failed to save the source check: ${wikiId}`);
  if (outcome === "saved" && deps.activeFileId === key) {
    deps.reopenActiveWikiFile?.(wikiId);
  }
  return outcome === "saved";
}

/** 1 件の知見に判定結果を保存する */
export async function saveSourceCheckResult(
  wikiId: string,
  profile: SourceCheckProfile,
  deps: SaveSourceCheckDeps,
): Promise<void> {
  await saveSourceCheckChange(wikiId, (doc) => attachSourceCheck(doc, profile), deps);
}

/**
 * runSourceCheck の結果（claimId → profile）をまとめて保存する。
 * 1 件が書けなくても残りは保存し、書けなかったものがあれば最後に例外にする
 */
export async function saveSourceCheckResults(
  profiles: Map<string, SourceCheckProfile>,
  deps: SaveSourceCheckDeps,
): Promise<void> {
  const failed: string[] = [];
  for (const [wikiId, profile] of profiles) {
    try {
      await saveSourceCheckResult(wikiId, profile, deps);
    } catch {
      failed.push(wikiId);
    }
  }
  if (failed.length > 0) throw new Error(`failed to save the source check: ${failed.join(", ")}`);
}
