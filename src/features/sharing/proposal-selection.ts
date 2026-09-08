// 「変更の提案」を取り込むときの選択（純関数・React 非依存）。仕様 §25b B-2。
//
// 何をする場所か:
//   差分エンジン（proposal-diff）が出した項目のうち、どれにチェックが入っているかを
//   Set<項目 id> で持つ。既定の選択と、チェックの入れ外しの規則だけをここに置く。
//
// 守っていること:
//   - 項目 id は文字列として解釈しない。差分エンジンが付けた id をそのまま鍵に使う
//     （`block:` / `cell:` の形は差分エンジンの都合であって、こちらの関心ではない）
//   - 親子は排他。表ブロックは「丸ごと置き換え」（BlockChange.id）と「セル単位」
//     （cells[].id）の 2 段があり、両方選ぶと適用側で丸ごと置換が勝つ。どちらの
//     つもりだったのか分からない状態を UI に作らない
//   - `by: "mine"`（元の作者だけが変えた）は取り込む対象ではない。表示はするが
//     選べない。既定で選ぶのは `by: "theirs"` だけで、`both`（競合）と
//     `unknown`（2 者比較）は人が判断して入れる

import type { BlockChange, ProposalChangeBy, ProposalDiff } from "./proposal-diff";

/** 取り込みの候補になりうるか。元の作者だけが変えたものは取り込む相手がいない */
export function isChangeSelectable(by: ProposalChangeBy): boolean {
  return by !== "mine";
}

/** 表ブロックのセル項目 id（セル単位の内訳を持たないブロックでは空） */
export function cellIdsOf(change: BlockChange): string[] {
  return (change.cells ?? []).map((cell) => cell.id);
}

/**
 * 既定の選択。`by: "theirs"` だけを選ぶ。
 *
 * 表ブロックにセル単位の内訳があるときは、丸ごと置き換えではなくセル項目を選ぶ。
 * 丸ごと置き換えは元の作者が足した行まで消してしまうので、既定にはしない。
 */
export function defaultProposalSelection(diff: ProposalDiff | null | undefined): Set<string> {
  const selected = new Set<string>();
  if (!diff) return selected;
  if (diff.title && diff.title.by === "theirs") selected.add(diff.title.id);
  for (const change of diff.blocks) {
    const cells = change.cells ?? [];
    if (cells.length > 0) {
      for (const cell of cells) {
        if (cell.by === "theirs") selected.add(cell.id);
      }
      continue;
    }
    if (change.by === "theirs") selected.add(change.id);
  }
  return selected;
}

/** 親（ブロック項目）→ 子（セル項目）と、その逆引き */
function relations(diff: ProposalDiff): {
  childrenOf: Map<string, string[]>;
  parentOf: Map<string, string>;
} {
  const childrenOf = new Map<string, string[]>();
  const parentOf = new Map<string, string>();
  for (const change of diff.blocks) {
    const cells = cellIdsOf(change);
    if (cells.length === 0) continue;
    childrenOf.set(change.id, cells);
    for (const cellId of cells) parentOf.set(cellId, change.id);
  }
  return { childrenOf, parentOf };
}

/**
 * チェックの入れ外し。親子が同時に入った状態は作らない。
 *   - 親（丸ごと置き換え）を入れる → その表のセル項目を全部外す
 *   - セル項目を入れる → その表の丸ごと置き換えを外す
 */
export function toggleProposalSelection(
  diff: ProposalDiff,
  selected: ReadonlySet<string>,
  id: string,
): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) {
    next.delete(id);
    return next;
  }
  const { childrenOf, parentOf } = relations(diff);
  next.add(id);
  for (const childId of childrenOf.get(id) ?? []) next.delete(childId);
  const parent = parentOf.get(id);
  if (parent) next.delete(parent);
  return next;
}

/**
 * そのセル項目が「親（丸ごと置き換え）に飲み込まれている」か。
 * UI ではチェック済み・操作不可として出す（選んだつもりの取りこぼしを作らない）。
 */
export function isCoveredByParent(
  selected: ReadonlySet<string>,
  parentId: string,
): boolean {
  return selected.has(parentId);
}

/** 選ばれている項目の数（表示用。親が選ばれていればその子は数えない） */
export function countSelected(
  diff: ProposalDiff | null | undefined,
  selected: ReadonlySet<string>,
): number {
  if (!diff) return 0;
  let count = 0;
  if (diff.title && selected.has(diff.title.id)) count += 1;
  for (const change of diff.blocks) {
    if (selected.has(change.id)) {
      count += 1;
      continue;
    }
    for (const cellId of cellIdsOf(change)) {
      if (selected.has(cellId)) count += 1;
    }
  }
  return count;
}
