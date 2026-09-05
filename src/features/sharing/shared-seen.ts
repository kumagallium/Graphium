// 「最後に見た」控え（手元だけ・localStorage `graphium-shared-seen`）。
//
// 何のためにあるか:
//   共有フォルダは誰でも読める場所なので、「誰がどこまで読んだか」を共有側に
//   書くと相手の閲覧記録を配ることになる。既読は各自の端末だけに置き、
//   Library の行に「更新あり」「新着コメント N」を出すためだけに使う。
//
// 守っていること:
//   - 共有フォルダには一切書かない。壊れても再構築できる控え（消えれば印が消えるだけ）
//   - 「更新あり」は控えと hash が違うときだけ。控えが無い（まだ一度も開いていない）
//     ものには出さない —— 全部に印が付くとノイズにしかならない
//   - 自分が作ったエントリには「更新あり」を出さない（自分の更新は自分で知っている）
//   - エントリの合計をタブ見出しやサイドバーには出さない（v1 の決定。ここは数を返すだけ）
//
// 設計詳細: docs/internal/team-shared-storage-design.md §21 B

import type { SharedEntry } from "../../lib/storage/shared";

export const SHARED_SEEN_KEY = "graphium-shared-seen";

/** 控えが増え続けないよう、新しい順にこの件数だけ残す */
const SEEN_LIMIT = 500;

export type SharedSeenRecord = {
  /** 最後に見たときの entry.hash */
  hash: string;
  /** 最後に見たときのコメント件数 */
  comments: number;
  /** 記録した時刻（ISO-8601）。上限を超えたときの間引きに使う */
  at: string;
};

export type SharedSeenStore = Record<string, SharedSeenRecord>;

/** 壊れた値・別の形が入っていても落とさずに読めるところだけ拾う */
export function parseSeenStore(raw: string | null): SharedSeenStore {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: SharedSeenStore = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const v = value as Partial<SharedSeenRecord>;
      if (typeof v.hash !== "string") continue;
      out[id] = {
        hash: v.hash,
        comments: typeof v.comments === "number" && v.comments >= 0 ? v.comments : 0,
        at: typeof v.at === "string" ? v.at : "",
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function readSeenStore(): SharedSeenStore {
  try {
    return parseSeenStore(localStorage.getItem(SHARED_SEEN_KEY));
  } catch {
    // localStorage が使えない環境（プライベートモード等）では控えを持たないだけ
    return {};
  }
}

function writeSeenStore(store: SharedSeenStore): void {
  try {
    localStorage.setItem(SHARED_SEEN_KEY, JSON.stringify(store));
  } catch {
    /* 容量超過・無効化。控えなので落とさない */
  }
}

/** 上限を超えた分を古い順（at の昇順）に落とす */
function prune(store: SharedSeenStore): SharedSeenStore {
  const ids = Object.keys(store);
  if (ids.length <= SEEN_LIMIT) return store;
  const sorted = ids.sort((a, b) => (store[b].at ?? "").localeCompare(store[a].at ?? ""));
  const out: SharedSeenStore = {};
  for (const id of sorted.slice(0, SEEN_LIMIT)) out[id] = store[id];
  return out;
}

/** 1 件の控えを引く（無ければ null） */
export function getSeen(id: string): SharedSeenRecord | null {
  return readSeenStore()[id] ?? null;
}

/**
 * 見たことを記録する。詳細パネルを開いたとき／ノートのコメントタブを開いたときに呼ぶ。
 * comments はその時点で見えているコメント件数（返信も含めた通し数）。
 */
export function markSeen(id: string, hash: string, comments: number): void {
  if (!id) return;
  const store = readSeenStore();
  store[id] = { hash, comments: Math.max(0, comments), at: new Date().toISOString() };
  writeSeenStore(prune(store));
}

/**
 * 「更新あり」を出すか。
 *
 * - 控えが無い（まだ開いていない）→ false
 * - 自分が作ったエントリ → false（selfEmail を渡したときのみ判定できる）
 * - 控えの hash と現在の hash が違う → true
 *
 * store を渡すと localStorage を読み直さない（一覧で行ごとに呼ぶとき用）。
 */
export function isUpdatedSince(
  entry: SharedEntry,
  selfEmail?: string | null,
  store?: SharedSeenStore,
): boolean {
  if (selfEmail && entry.author?.email === selfEmail) return false;
  const seen = (store ?? readSeenStore())[entry.id];
  if (!seen) return false;
  return seen.hash !== entry.hash;
}

/**
 * 前回見たときからのコメントの増分。控えが無ければ 0
 * （まだ開いていないものを「全部新着」にすると印だらけになる）。
 * 減っている（消された）ときも 0。
 */
export function newCommentCount(
  id: string,
  currentCount: number,
  store?: SharedSeenStore,
): number {
  const seen = (store ?? readSeenStore())[id];
  if (!seen) return 0;
  return Math.max(0, currentCount - seen.comments);
}

/** テスト用。控えを丸ごと消す */
export function __clearSharedSeenForTest(): void {
  try {
    localStorage.removeItem(SHARED_SEEN_KEY);
  } catch {
    /* 使えない環境では何もしない */
  }
}
