// 提案を出すときの「基準版（base）」の選び方（§25 A-3）。
//
// なぜ選択が要るか:
//   差分を 3 者（base / mine / theirs）で見られると、「提案者が変えた」と
//   「元の作者がその後変えた」を分けられる。base に使えるのは
//   「提案者が編集を始めた時点の元の本文」だけで、これは 2 通りの経路でしか手に入らない:
//     (a) 派生（fork）したときに手元へ控えた本文（fork-base.ts）
//     (b) 控えが無くても、元エントリが派生した時点から一度も更新されていないなら
//         「現在の本文 ＝ 派生した時点の本文」なので現在の本文で代用できる
//   どちらも無ければ base 無し（2 者比較に格下げ）。ここで「たぶん近いから」と
//   現在の本文を base に流用すると、作者がその後入れた変更まで提案者の変更として
//   数えてしまう —— 取り込みの候補を間違える方向の嘘になるので、やらない。
//
// 設計詳細: docs/internal/team-shared-storage-design.md §25 A-3

import type { SharedEntry } from "../../lib/storage/shared";
import { loadForkBase, type ForkBase } from "./fork-base";

/** 基準版がどこから来たか（ダイアログの説明と、詳細パネルの「基準版」行に出す） */
export type ProposalBaseOrigin =
  /** 派生した時点の控え（fork-base）から */
  | "fork"
  /** 控えは無いが、元エントリが派生時点から変わっていないので現在の本文で代用 */
  | "current"
  /** 基準版なし（2 者比較に落ちる） */
  | "none";

export type ResolvedProposalBase = {
  origin: ProposalBaseOrigin;
  /** 基準版の本文 JSON。origin === "none" のときは undefined */
  body?: string;
};

export type ResolveProposalBaseOptions = {
  /** 提案を出す手元ノートの id（控えのキー） */
  noteId: string;
  /** 提案先の元エントリ。読めていない（null）なら base 無し */
  target: SharedEntry | null;
  /** 手元ノートの forkedFrom（派生元の id と、派生した時点の hash） */
  forkedFrom?: { sharedId?: string; hash?: string } | null;
  /** DI: 控えの読み出し（既定は appData） */
  loadBase?: (noteId: string) => Promise<ForkBase | null>;
  /** DI: 元エントリの現在の本文を読む。(b) の経路でだけ呼ばれる */
  readTargetBody?: (entry: SharedEntry) => Promise<string | null>;
};

/**
 * 提案の基準版を決める。失敗（控えが壊れている・本文が読めない）は
 * base 無しに落とすだけで、提案そのものは止めない。
 */
export async function resolveProposalBase(
  options: ResolveProposalBaseOptions,
): Promise<ResolvedProposalBase> {
  const { noteId, target, forkedFrom } = options;
  if (!target) return { origin: "none" };

  // (a) 派生した時点の控え。別のノートから派生した控えを掴まないよう
  //     sharedId が提案先と一致するときだけ使う
  const load = options.loadBase ?? loadForkBase;
  try {
    const stored = noteId ? await load(noteId) : null;
    if (stored && stored.sharedId === target.id && stored.body) {
      return { origin: "fork", body: stored.body };
    }
  } catch {
    // 控えが読めないだけ。(b) へ落ちる
  }

  // (b) 元エントリが派生した時点から一度も更新されていなければ、
  //     現在の本文がそのまま派生した時点の本文
  const forkedHash = forkedFrom?.hash;
  if (forkedHash && target.hash && forkedHash === target.hash && options.readTargetBody) {
    try {
      const body = await options.readTargetBody(target);
      if (body) return { origin: "current", body };
    } catch {
      // 読めなければ base 無し
    }
  }

  // (c) どちらも無い
  return { origin: "none" };
}

/**
 * 元のノートが派生した時点から更新されているか（ダイアログの状態表示）。
 * hash が分からない（古い派生・元が読めていない）ときは「更新されている」とは言わない。
 */
export function isTargetUpdatedSinceFork(
  target: SharedEntry | null,
  forkedFrom?: { hash?: string } | null,
): boolean {
  if (!target || !forkedFrom?.hash || !target.hash) return false;
  return forkedFrom.hash !== target.hash;
}
