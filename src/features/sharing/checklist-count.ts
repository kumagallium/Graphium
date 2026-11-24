// 共有したノートの「チェックの件数」（印の付いた件数 / 全体の件数）。
//
// なぜ要るか:
//   計画の行ごとの記録（NotePlanRecordsPanel）で、記録を開かなくても「共有した時点で
//   チェックがいくつ付いていたか」を読めるようにする。先生が知りたい「どこまでやったか」に、
//   記録の中に書いてある事実だけで答える。
//
// 守っていること:
//   - 状態は増やさない。件数は本文のチェックリストから数えた結果で、本文と同じ版の写しを
//     封筒（extra.checklist）に添えるだけ。手元のノートや索引には何も足さない
//   - 件数だけを出す。割合・進みの棒・並べ替え・色での警告はしない（項目の重さは同じではなく、
//     チェックリストは「やること」とは限らない。材料や安全の確認にも使う）
//   - 本文と食い違う写しは使わない。写しには「どの本文を数えたか」（bodyHash）を入れ、
//     封筒の bodyHash と合うときだけ採る。この写しを知らない版のアプリが本文を書き換えると、
//     bodyHash だけが進んで写しは古いまま残るので、そこで外れる
//   - この端末で同じ版の本文を読んで数えた控え（派生メタ）があれば、そちらを先に使う。
//     写しは書いた人の申告で、控えは hash を確かめた本文から数えた値だから。
//     控えができるのは本文を読んだとき（記録を開いたときなど）で、一覧を開いただけでは読みに行かない
//   - どちらも無ければ何も出さない（0 件と「分からない」を混ぜない）

import { countChecklist } from "../navigation/index-file";
import type { SharedEntry } from "../../lib/storage/shared";

/** チェックリストの件数（total は 1 以上。チェックリストの無いノートは null で表す） */
export type SharedChecklistCount = {
  /** 印の付いた項目の数 */
  checked: number;
  /** チェックリスト項目の数（本文が空の項目は数えない） */
  total: number;
};

/** 封筒の extra.checklist の形。bodyHash は数えた本文の指紋（封筒の extra.bodyHash と同じ値） */
export type SharedChecklistMirror = SharedChecklistCount & { bodyHash: string };

/** 件数として受け取る上限。封筒は他の人が書くので、桁外れの値を画面に出さない */
const CHECKLIST_TOTAL_LIMIT = 9999;

/**
 * 外から来た値を件数として読む。形が合わなければ null。
 * 封筒も localStorage の控えも、こちらの書いた形とは限らない。
 */
export function parseChecklistCount(raw: unknown): SharedChecklistCount | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { checked, total } = raw as { checked?: unknown; total?: unknown };
  if (!Number.isInteger(checked) || !Number.isInteger(total)) return null;
  const c = checked as number;
  const n = total as number;
  if (n < 1 || n > CHECKLIST_TOTAL_LIMIT || c < 0 || c > n) return null;
  return { checked: c, total: n };
}

/** ノートの本文から件数を数える。チェックリストが無ければ null */
export function checklistCountOfDocument(
  doc: { pages?: { blocks?: unknown[] }[] } | null | undefined,
): SharedChecklistCount | null {
  const { checked, total } = countChecklist(doc);
  if (total < 1) return null;
  // 上限を超えるノートは上限で止める（印の数が全体を超えないようにそろえる）
  const capped = Math.min(total, CHECKLIST_TOTAL_LIMIT);
  return { checked: Math.min(checked, capped), total: capped };
}

/**
 * 封筒に添える写しを作る。チェックリストが無いノートは undefined
 * （extra にキーごと載せない。前の版の写しを引き継がないよう、呼び出し側は必ずこの値で上書きする）。
 */
export function buildChecklistMirror(
  doc: { pages?: { blocks?: unknown[] }[] } | null | undefined,
  bodyHash: string,
): SharedChecklistMirror | undefined {
  const count = checklistCountOfDocument(doc);
  if (!count || !bodyHash) return undefined;
  return { ...count, bodyHash };
}

/**
 * 封筒の写しを読む。対象はノートだけ。
 * 写しの bodyHash が封筒の bodyHash と合わないとき（別の本文を数えた古い写し）は null。
 */
export function readChecklistMirror(entry: SharedEntry): SharedChecklistCount | null {
  if (entry.type !== "note") return null;
  const extra = entry.extra as Record<string, unknown> | undefined;
  const raw = extra?.checklist;
  const count = parseChecklistCount(raw);
  if (!count) return null;
  const mirrorHash = (raw as { bodyHash?: unknown }).bodyHash;
  const bodyHash = extra?.bodyHash;
  if (typeof mirrorHash !== "string" || !mirrorHash || mirrorHash !== bodyHash) return null;
  return count;
}

/** 本文を読んだときの控え（派生メタ）のうち、件数の読み出しに要る分 */
type DerivedChecklist = Record<string, { hash: string; checklist?: SharedChecklistCount } | undefined>;

/**
 * 共有されたノートのチェックの件数を引く唯一の入口。優先順位はここ 1 か所に閉じる:
 *   1. 本文を読んだときの控え（封筒の hash が同じで、件数を持つときだけ）。
 *      hash を確かめた本文からこの端末が数えた値なので、申告である写しより先に採る
 *   2. 封筒の写し（本文と同じ版のときだけ）
 *   3. null（チェックリストが無い、または分からない。画面には何も出さない）
 * 控えに件数が無いときに写しへ進むのは、件数を拾う前の版が作った控えと見分けられないため。
 */
export function getSharedChecklistCount(
  entry: SharedEntry,
  derived: DerivedChecklist | undefined,
): SharedChecklistCount | null {
  if (entry.type !== "note") return null;
  // id は他の人が決める文字列なので、控えは自分の持ち物としてだけ引く（"constructor" などを拾わない）
  const kept = derived && Object.prototype.hasOwnProperty.call(derived, entry.id) ? derived[entry.id] : undefined;
  if (kept && kept.hash === entry.hash) {
    const counted = parseChecklistCount(kept.checklist);
    if (counted) return counted;
  }
  return readChecklistMirror(entry);
}
