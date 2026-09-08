// 共有ノートへの「変更の提案」（§25）。Git の Pull Request にあたる往復の、出す側。
//
// なぜ新しい種別を足したか:
//   fork したノートの変更を元のノートに反映してもらうには、誰かの封筒を
//   書き換えるか、別の封筒として置くかのどちらかしかない。共有フォルダは
//   author-owned（自分の封筒しか書けない）なので、提案も 1 通の封筒として
//   proposals/ に置き、extra.target で元エントリに結び付ける。コメント（§21）と
//   同じ形で、違うのは body が本文（GraphiumDocument JSON）であることだけ。
//
// 守っていること:
//   - 元エントリには一切書かない。取り込むかどうかは元の作者が自分の側で決める
//   - 1 つの手元ノートが指せる封筒は 1 通。提案として共有している間は通常の共有に
//     切り替えない（sharedRef.type が "proposal" 以外なら書き込みを断る）
//   - 基準版（base）は content-addressed な blob に置く。同じ版から出た複数の提案は
//     1 個に畳まれる。blob root 未設定なら base 無し（2 者比較に落ちる）で成立させる
//   - 語彙索引・投影の対象にしない（SHARED_INDEXABLE_TYPES に入れない）。
//     提案は「まだ元のノートになっていない差分」であって、検索で拾う記録ではない
//
// 設計詳細: docs/internal/team-shared-storage-design.md §25 / docs/DATA_MODEL.md §7.1.2

import type { GraphiumDocument } from "../../lib/document-types";
import type { AuthorIdentity } from "../document-provenance/types";
import {
  LocalFolderBlobProvider,
  type BlobRef,
  type SharedEntry,
} from "../../lib/storage/shared";
import {
  shareGraphiumDocument,
  type ShareNoteOptions,
  type ShareNoteResult,
} from "./share-note";
import { unshareEntry, type UnshareEntryResult } from "./unshare-entry";

/** 提案封筒の extra。対象と、比較の土台（基準版）を持つ。 */
export type SharedProposalExtra = {
  /** 提案ノートの題名（shareGraphiumDocument が doc.title から入れる） */
  title: string;
  /** 提案先＝元の共有エントリ id */
  target: string;
  /** 提案の土台にした元エントリの hash。現在の版か古い版かの判定に使う */
  targetHash: string;
  /** 元の題名（一覧の「元のノート」列。元が消えても何への提案か分かるように控える） */
  targetTitle: string;
  /** 提案の説明（任意・短文） */
  message?: string;
  /**
   * 基準版（fork した時点の本文 JSON）を置いた blob への参照。
   * これがあると base / mine / theirs の 3 者比較ができ、「提案者が変えた」と
   * 「元の作者がその後変えた」を分けられる。blob root 未設定なら付かない。
   */
  baseRef?: BlobRef;
  /** 本文に埋め込まれた媒体の BlobRef（ノート共有と同じ auto-blob） */
  blobs?: BlobRef[];
};

/** 提案の状態（一覧・バッジの表示に使う） */
export type ProposalStatus =
  /** 受け付け中 */
  | "open"
  /** 取り込み済み（元エントリの extra.adoptedProposals に載っている。8b で書かれる） */
  | "adopted"
  /** 元のノートがその後更新された */
  | "stale"
  /** 元のノートが見つからない（共有解除された等） */
  | "missing";

export type ProposalInput = {
  /** 提案先＝元の共有エントリ id */
  target: string;
  /** 提案の土台にした元エントリの hash */
  targetHash: string;
  /** 元の題名（一覧用の控え） */
  targetTitle: string;
  /** 提案の説明（任意） */
  message?: string;
  /**
   * 基準版の本文。fork 時の控え（fork-base.ts）か、元エントリの現在の本文。
   * 文字列で渡すと読んだままのバイト列で blob に置ける（同じ基準版の提案が
   * 1 個に畳まれる）。GraphiumDocument で渡した場合は JSON 化してから置く。
   * 省略すると base 無し＝ 2 者比較。
   */
  base?: string | GraphiumDocument;
};

export type ShareProposalOptions = ShareNoteOptions;
export type ShareProposalResult = ShareNoteResult;

/** base の blob に付けるファイル名（blob 一覧で何の控えか分かるように） */
const BASE_BLOB_FILENAME = "base.json";

function normalizeBase(base: ProposalInput["base"]): string | null {
  if (!base) return null;
  const json = typeof base === "string" ? base : JSON.stringify(base);
  return json.trim() ? json : null;
}

/**
 * fork したノートを、元のノートへの「変更の提案」として共有する。
 *
 * 既に提案として共有済み（sharedRef.type === "proposal"）なら同じ id に上書きする
 * （＝提案の更新。history に旧 hash が 1 行積まれる）。
 * 呼び出し側は戻り値の doc を保存すること（sharedRef が載っている）。
 */
export async function shareProposal(
  doc: GraphiumDocument,
  input: ProposalInput,
  options: ShareProposalOptions,
): Promise<ShareProposalResult> {
  if (!input.target || !input.target.trim()) {
    return { ok: false, error: "Proposal target is missing." };
  }
  // 通常の共有（note / knowledge）として書き出したノートを提案に付け替えない。
  // 同じ id に別種別で上書きすると、受け取り側の一覧から元の封筒が消える
  if (doc.sharedRef && doc.sharedRef.type !== "proposal") {
    return {
      ok: false,
      error:
        "This note is already shared as a copy of its own. Unshare it first to propose changes to another note.",
    };
  }

  let baseRef: BlobRef | undefined;
  const baseJson = normalizeBase(input.base);
  if (baseJson && options.blobRoot) {
    try {
      const blobProvider = new LocalFolderBlobProvider(options.blobRoot);
      baseRef = await blobProvider.put(new TextEncoder().encode(baseJson), {
        filename: BASE_BLOB_FILENAME,
      });
    } catch (e) {
      // 基準版が置けなくても提案そのものは出せる（2 者比較に落ちる）。
      // ここで失敗にすると「差分が細かく出ない」ためだけに提案が出せなくなる
      console.warn("提案の基準版を blob に置けませんでした:", e);
    }
  }

  const extra: Omit<SharedProposalExtra, "title"> = {
    target: input.target,
    targetHash: input.targetHash ?? "",
    targetTitle: input.targetTitle ?? "",
    ...(input.message?.trim() ? { message: input.message.trim() } : {}),
    ...(baseRef ? { baseRef } : {}),
  };

  return shareGraphiumDocument(doc, "proposal", extra, options, [input.target]);
}

/**
 * 提案を更新する（同じ封筒に上書き）。
 * 既存の isUpdate 経路をそのまま通るので、履歴は shareGraphiumDocument が積む。
 */
export async function updateProposal(
  doc: GraphiumDocument,
  input: ProposalInput,
  options: ShareProposalOptions,
): Promise<ShareProposalResult> {
  if (doc.sharedRef?.type !== "proposal") {
    return { ok: false, error: "This note is not shared as a proposal yet." };
  }
  return shareProposal(doc, input, options);
}

export type WithdrawProposalOptions = {
  root: string;
  author: AuthorIdentity;
  blobRoot?: string;
};

/**
 * 提案を取り下げる（tombstone 化）。他の種別の共有解除と同じ経路を使うので、
 * 参照されなくなった基準版 blob もここで GC される。
 * 手元ノートの sharedRef を外すのは呼び出し側の担当（他の unshare と同じ作法）。
 */
export function withdrawProposal(
  proposalId: string,
  options: WithdrawProposalOptions,
): Promise<UnshareEntryResult> {
  return unshareEntry(proposalId, options);
}

// ── 読み出し（純関数。封筒だけで数えられるようにする） ──

/**
 * 提案封筒の extra を型付きで読む。target を持たないものは提案として扱わない
 * （何への提案か分からない封筒は一覧にも逆引きにも出さない）。
 */
export function readProposalExtra(entry: SharedEntry): SharedProposalExtra | null {
  if (entry.type !== "proposal") return null;
  const extra = entry.extra as Partial<SharedProposalExtra> | undefined;
  if (!extra || typeof extra.target !== "string" || !extra.target) return null;
  return {
    title: typeof extra.title === "string" ? extra.title : "",
    target: extra.target,
    targetHash: typeof extra.targetHash === "string" ? extra.targetHash : "",
    targetTitle: typeof extra.targetTitle === "string" ? extra.targetTitle : "",
    ...(typeof extra.message === "string" && extra.message ? { message: extra.message } : {}),
    ...(extra.baseRef && typeof (extra.baseRef as BlobRef).hash === "string"
      ? { baseRef: extra.baseRef as BlobRef }
      : {}),
    ...(Array.isArray(extra.blobs) ? { blobs: extra.blobs as BlobRef[] } : {}),
  };
}

/**
 * 元エントリ id に付いた提案封筒だけを取り出す（本文は読まない）。
 *
 * 逆引きの「提案 N」は投影（shared-projection）ではなくここから数える。
 * 投影は本文を読めた分しか埋まらないが、提案は封筒の extra.target だけで
 * 分かるので、読めていなくても件数が正しく出る。
 */
export function proposalEntriesFor(
  targetId: string,
  entries: readonly SharedEntry[],
): SharedEntry[] {
  if (!targetId) return [];
  return entries.filter((e) => readProposalExtra(e)?.target === targetId);
}

/**
 * 元エントリ id → 提案件数の対応表を 1 回の走査で作る。
 * 行ごとに数え直すと「表示行数 × 提案総数」の走査になるので、
 * countCommentsByTarget と同じく数える側を 1 パスに寄せる。
 */
export function countProposalsByTarget(
  entries: readonly SharedEntry[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const target = readProposalExtra(entry)?.target;
    if (!target) continue;
    counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  return counts;
}

/** 元エントリの extra.adoptedProposals（8b で作者側が書く。8a では常に空） */
function adoptedIds(target: SharedEntry): string[] {
  const raw = (target.extra as Record<string, unknown> | undefined)?.adoptedProposals;
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string");
}

/**
 * 提案の状態を導出する（純関数。封筒に状態フィールドは持たせない）。
 *
 * 状態を封筒に書くと、書けるのは提案者だけなのに「取り込んだ」と言えるのは
 * 元の作者だけ、という食い違いが起きる。どちらの封筒からも読める材料
 * （元の hash と extra.adoptedProposals）から毎回導出する。
 *
 * @param target 元エントリ。渡さない（null）ときは entries から id で探す。
 *   見つからない＝共有解除された／まだ読めていない → "missing"
 */
export function proposalStatus(
  proposal: SharedEntry,
  target?: SharedEntry | null,
  entries?: readonly SharedEntry[],
): ProposalStatus {
  const extra = readProposalExtra(proposal);
  if (!extra) return "missing";
  const found =
    target ??
    (entries
      ? entries.find((e) => e.id === extra.target && e.type !== "proposal") ?? null
      : null);
  // tombstone は list に出ないが、直接渡された場合に備えて見る
  if (!found || found.status === "unshared") return "missing";
  if (adoptedIds(found).includes(proposal.id)) return "adopted";
  if (extra.targetHash && extra.targetHash !== found.hash) return "stale";
  return "open";
}
