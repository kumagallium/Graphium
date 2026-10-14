// 計算ブロックの書き戻し先を、ブロック id の振り直しに追従させる
//
// 書き戻し先は表の blockId で持つ（writeback.ts の CalcTarget）。テンプレートの
// 差し込み・ブロックの複製・コピペはどれもブロック id を振り直すので、表と計算を
// まとめて運ぶと、計算だけが元の（差し込み先には無い）表を指したまま残り、
// 書き戻しが黙って止まる。
//
// 規則: 書き戻し先の表が「一緒に運ばれた」（idMap に載っている）ときだけ新しい id へ
// 貼り替える。計算だけを運んだときは元の表を指したまま（従来どおり）にする。

import { parseCalcTargets, type CalcTargets } from "./writeback";

/**
 * props.targets（JSON 文字列）の tableBlockId を idMap で貼り替える。
 * 変化が無ければ null（呼び出し側が書き込みを省けるように）。
 */
export function remapCalcTargetsProp(
  raw: string,
  idMap: ReadonlyMap<string, string>,
): string | null {
  if (!raw) return null;
  const targets = parseCalcTargets(raw);
  let changed = false;
  const next: CalcTargets = {};
  for (const [name, target] of Object.entries(targets)) {
    const newId = idMap.get(target.tableBlockId);
    if (newId && newId !== target.tableBlockId) {
      next[name] = { ...target, tableBlockId: newId };
      changed = true;
    } else {
      next[name] = target;
    }
  }
  return changed ? JSON.stringify(next) : null;
}

/**
 * ブロックツリー（エディタに入れる前の複製）の中の計算ブロックを、その場で貼り替える。
 * テンプレートのように、挿入前のブロックを手元で持てる経路で使う。
 */
export function remapCalcTargetsInBlocks(
  blocks: any[],
  idMap: ReadonlyMap<string, string>,
): void {
  const walk = (list: any[]): void => {
    for (const b of list ?? []) {
      if (b?.type === "calc" && b.props) {
        const next = remapCalcTargetsProp(String(b.props.targets ?? ""), idMap);
        if (next !== null) b.props.targets = next;
      }
      if (Array.isArray(b?.children)) walk(b.children);
    }
  };
  walk(blocks);
}

/**
 * コピー範囲（blockIds）の中に、同じ範囲の表へ書き戻す計算ブロックがあるか。
 * あれば貼る側で id の対応を取る必要があるので、クリップボードに id を運ぶ。
 */
export function hasCalcTargetWithin(editor: any, blockIds: readonly string[]): boolean {
  if (!editor || blockIds.length < 2) return false;
  const ids = new Set(blockIds);
  for (const id of blockIds) {
    const block = editor.getBlock?.(id);
    if (block?.type !== "calc") continue;
    const targets = parseCalcTargets(String(block.props?.targets ?? ""));
    if (Object.values(targets).some((t) => ids.has(t.tableBlockId))) return true;
  }
  return false;
}

/**
 * エディタに入った後のブロックを貼り替える。複製・コピペのように、BlockNote が
 * 挿入してから id の対応（idMap: 元 id → 新 id）が分かる経路で使う。
 * 対象は新しく入った側（idMap の値）の計算ブロックだけ。元のブロックには触らない。
 */
export function remapCalcTargetsInEditor(
  editor: any,
  idMap: ReadonlyMap<string, string>,
): void {
  if (!editor || idMap.size === 0) return;
  for (const newId of idMap.values()) {
    const block = editor.getBlock?.(newId);
    if (!block || block.type !== "calc") continue;
    const next = remapCalcTargetsProp(String(block.props?.targets ?? ""), idMap);
    if (next !== null) editor.updateBlock(newId, { props: { targets: next } });
  }
}
