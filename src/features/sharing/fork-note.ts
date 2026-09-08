// 他人 (or 自分) の shared ノートを fork して、ローカル personal 側に
// 編集可能なコピーを作る（Phase 2c）。
//
// 設計判断:
// - fork はあくまで「ローカルに新規ノートを作る」操作。元の shared エントリは無変更
// - 新ノートには `forkedFrom` メタデータを持たせ、PROV-DM 系譜を後で辿れるようにする
// - 新ノートの `sharedRef` は付けない（再 Share した時点で自分名義の新 id が振られる）
// - body の JSON 復元に失敗した場合はエラーを返し、呼び出し側でユーザーに警告する
//
// 設計詳細: docs/internal/team-shared-storage-design.md §3 Fork

import type { GraphiumDocument } from "../../lib/document-types";
import {
  LocalFolderSharedProvider,
  type SharedEntry,
} from "../../lib/storage/shared";

export type ForkSharedNoteOptions = {
  /** Settings の shared root */
  root: string;
};

export type ForkSharedNoteResult =
  | {
      ok: true;
      doc: GraphiumDocument;
      original: SharedEntry;
      /**
       * 読み出した共有本文の JSON そのまま（作り直していない文字列）。
       * 「変更の提案」の基準版（fork-base.ts）に控えるために返す。
       * 読んだままのバイト列で blob に置けるよう、パースし直した値ではなく
       * 元の文字列を渡す（同じ基準版の提案が 1 個の blob に畳まれる）。
       */
      body: string;
    }
  | { ok: false; error: string };

/**
 * 指定 id の共有ノートを読み出し、ローカル新規作成用の GraphiumDocument を返す。
 * 呼び出し側はこの doc をファイルマネージャの新規保存パスに通すこと。
 */
export async function forkSharedNote(
  sharedId: string,
  options: ForkSharedNoteOptions,
): Promise<ForkSharedNoteResult> {
  try {
    // identity なしでも read は可能（write/delete のみ identity 必須）
    const provider = new LocalFolderSharedProvider(options.root);
    const { entry, body } = await provider.read(sharedId);

    if (entry.type !== "note") {
      return {
        ok: false,
        error: `Cannot fork ${entry.type} as note (only "note" entries can be forked into notes)`,
      };
    }

    const bodyJson = new TextDecoder().decode(body);
    let parsed: GraphiumDocument;
    try {
      parsed = JSON.parse(bodyJson) as GraphiumDocument;
    } catch (e) {
      return {
        ok: false,
        error: `Failed to deserialize shared note body: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    const now = new Date().toISOString();
    const baseTitle = parsed.title || "Untitled";
    // タイトルに「(forked)」を付けて元と区別。ユーザーは保存後に自由に変更可
    const forkedTitle = `${baseTitle} (forked)`;

    const forked: GraphiumDocument = {
      ...parsed,
      title: forkedTitle,
      // 共有関係はリセット（再 Share 時に自分名義で新 id が振られる）
      sharedRef: undefined,
      forkedFrom: {
        sharedId: entry.id,
        hash: entry.hash,
        authorName: entry.author?.name ?? "(unknown)",
        authorEmail: entry.author?.email ?? "",
        forkedAt: now,
      },
      // 共有元のフォルダ（noteContexts）は引き継がない。
      // なぜ: フォルダは共有した人の個人的な整理であって、fork した側の分類ではない。
      //       引き継ぐと自分のフォルダ一覧に他人の分類が勝手に増える。
      //       共有時点のフォルダは共有ライブラリの表の「フォルダ」列で参照できる。
      noteContexts: undefined,
      // ローカル間派生関係は保持しない（ローカル ID は別空間）
      derivedFromNoteId: undefined,
      derivedFromBlockId: undefined,
      createdAt: now,
      modifiedAt: now,
      // documentProvenance は元のものを引き継ぐと history が混線するためリセット
      documentProvenance: undefined,
    };

    return { ok: true, doc: forked, original: entry, body: bodyJson };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
