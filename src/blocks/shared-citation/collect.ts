// 保存 diff から「今回の編集で新しく挿入された shared:// 引用」を検出する。
//
// 保存時（recordRevision）の sources に `shared:<id>` を渡し、EditActivity.used
// （prov:used）として「このリビジョンはどの共有エントリを引用したか」を残すための
// ヘルパー。既存の外部ソース規約（external-source.ts）の "shared:" プレフィックスに従う。
//
// ブロックが後で削除されても used の記録は消さない（「その時点で引用した」という
// 事実の記録であり、現在参照しているかはドキュメント本文が担う）。

type AnyBlock = {
  type?: string;
  props?: Record<string, unknown>;
  children?: AnyBlock[];
};

/** ページ（ブロック木）から sharedCitation の sharedId 集合を収集する */
export function collectSharedCitationIds(blocks: unknown): Set<string> {
  const out = new Set<string>();
  const visit = (list: AnyBlock[]) => {
    for (const b of list ?? []) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "sharedCitation") {
        const id = b.props?.sharedId;
        if (typeof id === "string" && id) out.add(id);
      }
      if (Array.isArray(b.children) && b.children.length > 0) visit(b.children);
    }
  };
  if (Array.isArray(blocks)) visit(blocks as AnyBlock[]);
  return out;
}

/**
 * 前回保存ページとの比較で新規に現れた引用を `shared:<id>` 形式で返す。
 * prevPage が null（初回保存）の場合は現ページの全引用が新規扱い。
 */
export function collectNewSharedCitationSources(
  prevBlocks: unknown,
  currentBlocks: unknown,
): string[] {
  const prev = collectSharedCitationIds(prevBlocks);
  const current = collectSharedCitationIds(currentBlocks);
  const added: string[] = [];
  for (const id of current) {
    if (!prev.has(id)) added.push(`shared:${id}`);
  }
  return added;
}
