// ──────────────────────────────────────────────
// ブロック複製の純ロジック
//
// 複製は「同じ見た目・同じ来歴メタを持つ別のブロック」を作る操作。
// ブロック ID は BlockNote に新規発番させるため、挿入用のツリーからは
// id を落とす必要がある（同じ id を渡すと ProseMirror 側で衝突する）。
//
// 旧 ID → 新 ID の対応付けは clipboard.ts と同じ「深さ優先の順序対応」で行う。
// コピペとロジックを揃えておくと、複製とコピペで引き継がれるメタの範囲が
// 一致し、説明が一貫する。
// ──────────────────────────────────────────────

/**
 * ブロックツリーを深いコピーにして id を取り除く（children も再帰的に）。
 * 返り値は BlockNote の PartialBlock として insertBlocks に渡せる形。
 */
export function stripBlockIds(block: any): any {
  const clone = structuredClone(block);
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    delete node.id;
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  };
  walk(clone);
  return clone;
}
