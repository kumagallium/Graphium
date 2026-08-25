// 他人 (or 自分) の shared Knowledge を fork して、ローカル Wiki 側に
// 編集可能なコピーを作る。fork-note.ts の Knowledge 版。
//
// fork-note との共通設計:
// - fork は「ローカルに新規 Wiki ページを作る」操作。元の shared エントリは無変更
// - `forkedFrom` で PROV-DM 系譜を辿れるようにする
// - `sharedRef` は付けない（再 Share した時点で自分名義の新 id が振られる）
//
// Knowledge 固有: wikiMeta の環境依存フィールドをリセットする。
// 共有元の環境のローカル ID（ノート / チャット / Claim / Atom の id）は
// この環境では解決できず、グラフ・来歴・regenerate に dangling ID を流し込む
// 事故のもとになる（外部プレフィックス ID を黙って落としていた過去バグと同型）。
// 共有元との系譜は doc レベルの forkedFrom が一手に担う。

import type { GraphiumDocument } from "../../lib/document-types";
import {
  LocalFolderSharedProvider,
  type SharedEntry,
} from "../../lib/storage/shared";

export type ForkSharedKnowledgeOptions = {
  /** Settings の shared root */
  root: string;
};

export type ForkSharedKnowledgeResult =
  | {
      ok: true;
      doc: GraphiumDocument;
      original: SharedEntry;
    }
  | { ok: false; error: string };

/**
 * 指定 id の共有 Knowledge を読み出し、ローカル新規作成用の GraphiumDocument を返す。
 * 呼び出し側はこの doc を createWikiFile 経路に通すこと。
 */
export async function forkSharedKnowledge(
  sharedId: string,
  options: ForkSharedKnowledgeOptions,
): Promise<ForkSharedKnowledgeResult> {
  try {
    // identity なしでも read は可能（write/delete のみ identity 必須）
    const provider = new LocalFolderSharedProvider(options.root);
    const { entry, body } = await provider.read(sharedId);

    if (entry.type !== "knowledge") {
      return {
        ok: false,
        error: `Cannot fork ${entry.type} as knowledge (only "knowledge" entries can be forked into the wiki)`,
      };
    }

    let parsed: GraphiumDocument;
    try {
      const json = new TextDecoder().decode(body);
      parsed = JSON.parse(json) as GraphiumDocument;
    } catch (e) {
      return {
        ok: false,
        error: `Failed to deserialize shared knowledge body: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    if (!parsed.wikiMeta) {
      return {
        ok: false,
        error: "Shared knowledge body has no wikiMeta (corrupt entry)",
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
      // ローカル間派生関係は保持しない（ローカル ID は別空間）
      derivedFromNoteId: undefined,
      derivedFromBlockId: undefined,
      createdAt: now,
      modifiedAt: now,
      // documentProvenance は元のものを引き継ぐと history が混線するためリセット
      documentProvenance: undefined,
      wikiMeta: {
        ...parsed.wikiMeta,
        // 共有元環境のローカル ID 参照はすべてリセット（forkedFrom が系譜を担う）
        derivedFromNotes: [],
        derivedFromChats: [],
        derivedFromClaims: undefined,
        citedKnowledgeIds: undefined,
        relatedAtoms: undefined,
        // ローカル埋め込み索引・世界照合はこの環境で作り直させる
        sectionEmbeddings: undefined,
        grounding: undefined,
        // backing の内部 Claim 参照も別空間の ID なので剥がす（citation 文言は残す）
        backing: parsed.wikiMeta.backing?.map((b) => ({
          ...b,
          internalClaimId: undefined,
        })),
        // editedSections は本文ブロックへの印（doc 内で自己完結）なので保持
      },
    };

    return { ok: true, doc: forked, original: entry };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
