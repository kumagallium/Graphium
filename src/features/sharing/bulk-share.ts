// 複数選択したノート / Knowledge / 素材を一括で team-shared storage に共有する。
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
import type {
  MediaIndexEntry,
  MediaSharedRef,
} from "../asset-browser/media-index";
import {
  assetFolderValues,
  type NoteFolderLookup,
} from "../asset-browser/asset-folders";
import { t } from "../../i18n";
import { shareNote } from "./share-note";
import { shareKnowledge } from "./share-knowledge";
import { shareMedia } from "./share-media";
import { shareReference } from "./share-reference";

/** lookup 未指定時の空表。毎回新しい Map を作らないよう共有する */
const EMPTY_NOTE_FOLDER_LOOKUP: NoteFolderLookup = new Map();

export type BulkShareTarget = {
  id: string;
  /** media の id は MediaIndexEntry.fileId */
  kind: "note" | "knowledge" | "media";
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
  /**
   * 素材インデックスから entry を引く（見つからなければ null）。
   * ノート / Knowledge のように storage から読み直さないのは、素材の共有に
   * 必要な情報（fileId / type / usedIn / sharedRef）が全てインデックス側にあるため。
   * kind: "media" を渡すなら必須。
   */
  loadMedia?: (fileId: string) => Promise<MediaIndexEntry | null> | MediaIndexEntry | null;
  /**
   * 素材の sharedRef 書き戻し。単体経路（MaterialActionsMenu の onSharedRefUpdated）
   * と同じ関数を渡すこと — media index への保存作法を 1 箇所に保つため。
   * kind: "media" を渡すなら必須。
   */
  saveMediaSharedRef?: (
    entry: MediaIndexEntry,
    sharedRef: MediaSharedRef,
  ) => Promise<void> | void;
  /**
   * 素材の実効フォルダを導くための参照表。共有側に載せるフォルダを
   * 素材ギャラリー（と単体共有）が表示している値と一致させるために使う。
   * 未指定ならフォルダ無しで共有する（共有ライブラリの表で空欄になるだけ）。
   */
  noteFolderLookup?: NoteFolderLookup;
  onProgress?: (done: number, total: number, currentTitle: string) => void;
  isCancelled?: () => boolean;
};

/**
 * 素材 1 件を共有する。URL ブックマークはバイト実体を持たないので reference、
 * それ以外は blob 付き data-manifest（単体経路 material-actions-menu と同じ振り分け）。
 */
async function shareOneMedia(
  target: BulkShareTarget,
  deps: BulkShareDeps,
  index: number,
  total: number,
): Promise<BulkShareItemResult> {
  let title = "";
  try {
    const entry = deps.loadMedia ? await deps.loadMedia(target.id) : null;
    if (!entry) {
      return { ...target, title: target.id, ok: false, error: "Asset not found" };
    }
    title = entry.name || target.id;
    deps.onProgress?.(index, total, title);

    const isUrlEntry = entry.type === "url";
    if (!isUrlEntry && !deps.blobRoot) {
      // blob root が無いと実体バイト列の置き場が無い。ここで止めないと
      // shareMedia が内部エラーで落ちるだけで、原因が UI に出ない
      return { ...target, title, ok: false, error: t("share.media.disabled.noBlobRoot") };
    }

    // 素材ギャラリーの「フォルダ」と同じ値を共有側にも載せる（単体経路と同じ引き方）
    const noteContexts = assetFolderValues(
      entry,
      deps.noteFolderLookup ?? EMPTY_NOTE_FOLDER_LOOKUP,
    );
    const result = isUrlEntry
      ? await shareReference(entry, {
          sharedRoot: deps.root,
          author: deps.author,
          title: entry.name,
          description: "",
          noteContexts,
        })
      : await shareMedia(entry, {
          sharedRoot: deps.root,
          blobRoot: deps.blobRoot!,
          author: deps.author,
          title: entry.name,
          description: "",
          noteContexts,
        });
    if (!result.ok) {
      return { ...target, title, ok: false, error: result.error };
    }

    if (!deps.saveMediaSharedRef) {
      // 共有はできたが sharedRef を残す手段が無い＝次回 Share が同 id に繋がらない。
      // ノート経路の書き戻し失敗と同じ扱いで失敗として報告する（配線漏れの検出も兼ねる）
      return {
        ...target,
        title,
        ok: false,
        error: "Shared, but failed to record sharedRef locally",
      };
    }
    await deps.saveMediaSharedRef(entry, result.sharedRef);

    return { ...target, title, ok: true, isUpdate: result.isUpdate };
  } catch (e) {
    return {
      ...target,
      title: title || target.id,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

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
    if (target.kind === "media") {
      // 素材はドキュメントを読まない別経路。ノート / Knowledge の流れは触らない
      results.push(await shareOneMedia(target, deps, i, targets.length));
      continue;
    }
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
