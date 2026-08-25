// 複数選択したノート / Knowledge を一括で team-shared storage に共有する。
//
// 設計判断:
// - 逐次処理（並列にしない）。Share は blob 化を伴い 1 件が重く、
//   shared root（NAS 等）への並列書き込みはエラー時の切り分けを難しくする
// - 対象は「保存済みのドキュメント」。エディタで開いている未保存編集は含まれない
// - 既に共有済み（sharedRef あり）のものは同 id 上書き = minor 改訂（Update 扱い）
// - 1 件の失敗で全体を止めない。失敗は結果に集計して UI で見せる
// - 保存書き戻し（sharedRef の永続化）は呼び出し側から注入する。ここで
//   provider を直接触らないのは、docCache / activeDoc への追従（use-file-manager
//   の作法）を呼び出し側の責務として一箇所に保つため

import type { GraphiumDocument } from "../../lib/document-types";
import type { AuthorIdentity } from "../document-provenance/types";
import { shareNote } from "./share-note";
import { shareKnowledge } from "./share-knowledge";

export type BulkShareTarget = {
  id: string;
  kind: "note" | "knowledge";
};

export type BulkShareItemResult = {
  id: string;
  kind: BulkShareTarget["kind"];
  title: string;
  ok: boolean;
  /** ok のとき: 既存共有の更新だったか */
  isUpdate?: boolean;
  error?: string;
};

export type BulkShareSummary = {
  results: BulkShareItemResult[];
  shared: number;
  updated: number;
  failed: number;
  /** キャンセルで打ち切った場合 true（results は処理済み分のみ） */
  cancelled: boolean;
};

export type BulkShareDeps = {
  root: string;
  author: AuthorIdentity;
  blobRoot?: string | null;
  /** 保存済みノートを読む（見つからなければ null） */
  loadNote: (id: string) => Promise<GraphiumDocument | null>;
  /** sharedRef 付き doc の書き戻し（docCache / activeDoc 追従込み） */
  saveNote: (id: string, doc: GraphiumDocument) => Promise<void>;
  loadKnowledge: (id: string) => Promise<GraphiumDocument | null>;
  /** false が返ったら保存失敗として扱う（handleSaveWikiFile の契約） */
  saveKnowledge: (id: string, doc: GraphiumDocument) => Promise<boolean>;
  onProgress?: (done: number, total: number, currentTitle: string) => void;
  isCancelled?: () => boolean;
};

export async function bulkShare(
  targets: BulkShareTarget[],
  deps: BulkShareDeps,
): Promise<BulkShareSummary> {
  const results: BulkShareItemResult[] = [];
  let cancelled = false;

  for (let i = 0; i < targets.length; i++) {
    if (deps.isCancelled?.()) {
      cancelled = true;
      break;
    }
    const target = targets[i];
    const isKnowledge = target.kind === "knowledge";
    let title = "";
    try {
      const doc = isKnowledge
        ? await deps.loadKnowledge(target.id)
        : await deps.loadNote(target.id);
      if (!doc) {
        results.push({
          ...target,
          title: target.id,
          ok: false,
          error: "Document not found",
        });
        continue;
      }
      title = doc.title || "(untitled)";
      deps.onProgress?.(i, targets.length, title);

      const share = isKnowledge ? shareKnowledge : shareNote;
      const result = await share(doc, {
        root: deps.root,
        author: deps.author,
        blobRoot: deps.blobRoot,
      });
      if (!result.ok) {
        results.push({ ...target, title, ok: false, error: result.error });
        continue;
      }

      const saved = isKnowledge
        ? await deps.saveKnowledge(target.id, result.doc)
        : await deps.saveNote(target.id, result.doc).then(() => true);
      if (!saved) {
        // shared 側には書けたがローカルの sharedRef 書き戻しに失敗。
        // 次回 Share で同 id に繋がらなくなるので失敗として報告する
        results.push({
          ...target,
          title,
          ok: false,
          error: "Shared, but failed to record sharedRef locally",
        });
        continue;
      }

      results.push({ ...target, title, ok: true, isUpdate: result.isUpdate });
    } catch (e) {
      results.push({
        ...target,
        title: title || target.id,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const shared = results.filter((r) => r.ok && !r.isUpdate).length;
  const updated = results.filter((r) => r.ok && r.isUpdate).length;
  const failed = results.filter((r) => !r.ok).length;
  return { results, shared, updated, failed, cancelled };
}
