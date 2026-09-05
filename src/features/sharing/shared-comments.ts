// 共有エントリへのコメント（先生 ⇄ 学生の往復の中身）。
//
// なぜ新しい種別を足したか:
//   コメントは「対象エントリの一部」ではなく「別人が書いた別の文書」。対象の封筒に
//   書き足す形にすると author-owned（自分の封筒しか書き換えられない）を壊すので、
//   コメントも 1 通の封筒として comments/ に置き、extra.target で対象に結び付ける。
//   これで「先生が学生のノートにコメントする」が、誰の所有物も侵さずに成立する。
//
// 守っていること:
//   - 1 段のスレッドだけ（返信への返信は親コメントにぶら下げる）。木にすると
//     読む側の負荷が上がるうえ、指摘 → 返答という往復には深さが要らない
//   - 「解決」フラグは持たない。学生が直して共有コピーを更新すると対象の hash が
//     変わるので、古い版に付いたコメントは splitByTargetVersion が自動で畳む
//   - 語彙索引・投影・blob GC の対象外（SHARED_INDEXABLE_TYPES / BLOB_REFERENCING_TYPES
//     に入れない）。コメントは指摘であって素材ではない
//   - PROV には記録しない（v1）
//
// 設計詳細: docs/internal/team-shared-storage-design.md §21

import type { AuthorIdentity } from "../document-provenance/types";
import {
  LocalFolderSharedProvider,
  newSharedId,
  type SharedEntry,
} from "../../lib/storage/shared";
import { readSharedEntryBody } from "./shared-library-store";

/** コメント封筒の extra。対象と、付けた時点のスナップショットを持つ。 */
export type SharedCommentExtra = {
  /** 対象の共有エントリ id */
  target: string;
  /** 付けた時点の対象の hash。現在の版か古い版かの判定に使う */
  targetHash: string;
  /** 段落に付けたときの対象ブロック id */
  blockId?: string;
  /**
   * 付けた時点の段落抜粋（最大 80 文字）。ブロックが消されたあとに
   * 「何に対する指摘だったか」を残すための墓標。
   */
  blockText?: string;
  /** 返信先コメント id。1 段のみ（返信への返信は親に付け替える） */
  parentId?: string;
};

/** 表示側が扱う 1 件のコメント（封筒 + 本文テキスト）。 */
export type SharedComment = {
  id: string;
  author: AuthorIdentity;
  createdAt: string;
  updatedAt: string;
  /** 本文。まだ読めていない場合は空文字（封筒だけ先に一覧できる） */
  text: string;
  target: string;
  targetHash: string;
  blockId?: string;
  blockText?: string;
  parentId?: string;
};

/** 1 段のスレッド。root にぶら下がる返信は作成日昇順。 */
export type CommentThread = {
  root: SharedComment;
  replies: SharedComment[];
};

export type SharedCommentResult =
  | { ok: true; entry: SharedEntry }
  | { ok: false; error: string };

/**
 * write / read / delete だけを使う。テストと Storybook から差し替えられるよう
 * Provider 全体ではなく必要な 3 メソッドで受ける。
 */
export type SharedCommentProvider = {
  read(id: string): Promise<{ entry: SharedEntry; body: Uint8Array }>;
  write(entry: SharedEntry, content: Uint8Array): Promise<void>;
  delete(id: string): Promise<void>;
};

/** 抜粋・要約の最大長（メモの ¶ チップと揃える） */
const SUMMARY_MAX = 120;

function providerFor(
  root: string,
  author: AuthorIdentity,
  override?: SharedCommentProvider,
): SharedCommentProvider {
  return override ?? new LocalFolderSharedProvider(root, { email: author.email });
}

/** identity 未登録では共有ストレージに書けない（author-owned の前提が立たない） */
function assertIdentity(author: AuthorIdentity | null | undefined): string | null {
  if (!author || !author.email || !author.email.trim()) {
    return "Author identity is not configured. Set your name and email in Settings → Shared storage.";
  }
  return null;
}

function toError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ── 作成・編集・削除（author-owned） ──

export type CreateCommentOptions = {
  /** 共有ルート */
  root: string;
  /** Settings 登録済みの AuthorIdentity（必須） */
  author: AuthorIdentity;
  /** 対象の共有エントリ id */
  target: string;
  /** 付けた時点の対象の hash */
  targetHash: string;
  /** 本文（UTF-8 プレーン、改行可） */
  text: string;
  /** 段落に付けるとき */
  blockId?: string;
  blockText?: string;
  /** 返信先。返信への返信は呼び出し側で親 id に付け替えてから渡す */
  parentId?: string;
  /** テスト用の差し替え */
  __provider?: SharedCommentProvider;
};

/** コメントを 1 通書く。prov.derived_from に対象を入れて系譜を残す。 */
export async function createComment(
  options: CreateCommentOptions,
): Promise<SharedCommentResult> {
  const identityError = assertIdentity(options.author);
  if (identityError) return { ok: false, error: identityError };
  const text = options.text.trim();
  if (!text) return { ok: false, error: "Comment body is empty" };
  try {
    const now = new Date().toISOString();
    const extra: SharedCommentExtra = {
      target: options.target,
      targetHash: options.targetHash,
      ...(options.blockId ? { blockId: options.blockId } : {}),
      ...(options.blockText ? { blockText: options.blockText.slice(0, 80) } : {}),
      ...(options.parentId ? { parentId: options.parentId } : {}),
    };
    const entry: SharedEntry = {
      id: newSharedId(),
      type: "comment",
      author: options.author,
      created_at: now,
      updated_at: now,
      hash: "", // provider.write が再計算する
      prov: { derived_from: [options.target] },
      extra: extra as unknown as Record<string, unknown>,
    };
    const body = new TextEncoder().encode(text);
    const provider = providerFor(options.root, options.author, options.__provider);
    await provider.write(entry, body);
    return { ok: true, entry };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

export type EditCommentOptions = {
  root: string;
  author: AuthorIdentity;
  /** 書き換えるコメントの id（同じ id に上書き） */
  id: string;
  text: string;
  __provider?: SharedCommentProvider;
};

/**
 * 本文だけ書き換える。対象・段落・親は書いた時点のものを保つ
 * （どこに付けた指摘かは編集で動かさない）。他人のコメントは
 * Provider の author 一致チェックで弾かれる。
 */
export async function editComment(
  options: EditCommentOptions,
): Promise<SharedCommentResult> {
  const identityError = assertIdentity(options.author);
  if (identityError) return { ok: false, error: identityError };
  const text = options.text.trim();
  if (!text) return { ok: false, error: "Comment body is empty" };
  try {
    const provider = providerFor(options.root, options.author, options.__provider);
    const existing = await provider.read(options.id);
    if (existing.entry.type !== "comment") {
      return { ok: false, error: `Not a comment entry: ${options.id}` };
    }
    const entry: SharedEntry = {
      ...existing.entry,
      updated_at: new Date().toISOString(),
      hash: "",
    };
    await provider.write(entry, new TextEncoder().encode(text));
    return { ok: true, entry };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

export type DeleteCommentOptions = {
  root: string;
  author: AuthorIdentity;
  id: string;
  __provider?: SharedCommentProvider;
};

/** tombstone 化（他の種別の共有解除と同じ作法）。 */
export async function deleteComment(
  options: DeleteCommentOptions,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const identityError = assertIdentity(options.author);
  if (identityError) return { ok: false, error: identityError };
  try {
    const provider = providerFor(options.root, options.author, options.__provider);
    await provider.delete(options.id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

// ── 読み出し（純関数 + 本文の取り寄せ） ──

function readExtra(entry: SharedEntry): SharedCommentExtra | null {
  const extra = entry.extra as Partial<SharedCommentExtra> | undefined;
  if (!extra || typeof extra.target !== "string" || !extra.target) return null;
  return {
    target: extra.target,
    targetHash: typeof extra.targetHash === "string" ? extra.targetHash : "",
    ...(typeof extra.blockId === "string" && extra.blockId ? { blockId: extra.blockId } : {}),
    ...(typeof extra.blockText === "string" && extra.blockText
      ? { blockText: extra.blockText }
      : {}),
    ...(typeof extra.parentId === "string" && extra.parentId
      ? { parentId: extra.parentId }
      : {}),
  };
}

/** 対象 id に付いたコメント封筒だけを取り出す（本文は読まない）。 */
export function commentEntriesFor(
  targetId: string,
  entries: readonly SharedEntry[],
): SharedEntry[] {
  if (!targetId) return [];
  return entries.filter(
    (e) => e.type === "comment" && readExtra(e)?.target === targetId,
  );
}

/** 対象に付いたコメントの件数（ヘッダのバッジ・新着判定用）。 */
export function countCommentsFor(
  targetId: string,
  entries: readonly SharedEntry[],
): number {
  return commentEntriesFor(targetId, entries).length;
}

/**
 * 対象 id → コメント件数の対応表を 1 回の走査で作る。
 *
 * なぜ専用の関数が要るか:
 *   一覧（Library の表）は行ごとに件数が要る。行ごとに countCommentsFor を呼ぶと
 *   「表示行数 × コメント総数」の走査になり、共有フォルダが育つほど再読込のたびに
 *   重くなる。数える側を 1 パスに寄せて「行数 + コメント数」で済ませる。
 */
export function countCommentsByTarget(
  entries: readonly SharedEntry[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.type !== "comment") continue;
    const target = readExtra(entry)?.target;
    if (!target) continue;
    counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  return counts;
}

/**
 * コメント本文をまとめて読む。id → テキストの Map を返す。
 *
 * 本文は封筒とは別に取りに行く必要があるが、readSharedEntryBody は
 * `id|hash` の LRU 付きなので同じ版は 1 回しか読まない。hash が合わない
 * ものは中身を信用せず空にする（改ざん検知の扱いを他の種別と揃える）。
 */
export async function loadCommentTexts(
  entries: readonly SharedEntry[],
  read: (entry: SharedEntry) => Promise<{ body: Uint8Array; verified: boolean }> =
    readSharedEntryBody,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const decoder = new TextDecoder();
  for (const entry of entries) {
    if (entry.type !== "comment") continue;
    try {
      const { body, verified } = await read(entry);
      out.set(entry.id, verified ? decoder.decode(body) : "");
    } catch {
      // 読めなかった（消された・権限なし）→ 本文なしで一覧には出す
      out.set(entry.id, "");
    }
  }
  return out;
}

function toComment(entry: SharedEntry, text: string): SharedComment | null {
  const extra = readExtra(entry);
  if (!extra) return null;
  return {
    id: entry.id,
    author: entry.author,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
    text,
    ...extra,
  };
}

const byCreatedAtAsc = (a: SharedComment, b: SharedComment): number =>
  a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt);

/**
 * 対象 id に付いたコメントをスレッドに組み立てる（root → replies、作成日昇順）。
 *
 * texts を渡さなければ本文は空のまま組み立てる（封筒だけで件数・並びを出す用）。
 * 親が見つからない返信は、失わせないために自分自身を root として扱う。
 */
export function commentsFor(
  targetId: string,
  entries: readonly SharedEntry[],
  texts?: ReadonlyMap<string, string>,
): CommentThread[] {
  const comments: SharedComment[] = [];
  for (const entry of commentEntriesFor(targetId, entries)) {
    const c = toComment(entry, texts?.get(entry.id) ?? "");
    if (c) comments.push(c);
  }
  comments.sort(byCreatedAtAsc);

  const byId = new Map(comments.map((c) => [c.id, c] as const));
  /** 返信の返信は親をたどって root に寄せる（1 段しか作らない） */
  const rootIdOf = (c: SharedComment): string => {
    const seen = new Set<string>([c.id]);
    let cur = c;
    while (cur.parentId) {
      const parent = byId.get(cur.parentId);
      if (!parent || seen.has(parent.id)) break;
      seen.add(parent.id);
      cur = parent;
    }
    return cur.id;
  };

  const threads = new Map<string, CommentThread>();
  for (const c of comments) {
    const rootId = rootIdOf(c);
    if (rootId === c.id) {
      threads.set(c.id, { root: c, replies: [] });
    }
  }
  for (const c of comments) {
    const rootId = rootIdOf(c);
    if (rootId === c.id) continue;
    threads.get(rootId)?.replies.push(c);
  }
  return [...threads.values()].sort((a, b) => byCreatedAtAsc(a.root, b.root));
}

/**
 * 現在の版に付いたスレッドと、古い版に付いたスレッドに分ける。
 *
 * 判定は root の targetHash。返信は root に従う（同じ話の続きを引き離さない）。
 * 「解決」フラグの代わりに、対象が更新されれば指摘が自動で畳まれる。
 */
export function splitByTargetVersion(
  threads: readonly CommentThread[],
  currentHash: string,
): { current: CommentThread[]; older: CommentThread[] } {
  const current: CommentThread[] = [];
  const older: CommentThread[] = [];
  for (const thread of threads) {
    // hash が分からない（控えの無い古いコメント）は現在の版として見せる
    if (!thread.root.targetHash || thread.root.targetHash === currentHash) current.push(thread);
    else older.push(thread);
  }
  return { current, older };
}

/** 一覧・通知に使う 1 行要約（本文の最初の空でない行）。 */
export function commentSummary(body: string): string {
  const line = (body ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return "";
  return line.length > SUMMARY_MAX ? `${line.slice(0, SUMMARY_MAX)}…` : line;
}
