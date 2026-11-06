// 共有フォルダをまたぐ引用の検出（§26 PR4）。
//
// 共有フォルダは読める人が違う（例: 組織全体と部署 A）。組織全体へ出すノートが部署 A の
// 共有エントリを引用していると、部署 A を読めない人には引用カードが「見つからない」になり、
// 題名だけが見えてしまう。どちらが「広い」かは Graphium には分からない（権限はフォルダ側）ので、
// 「共有先と違うフォルダにあるものを引用している」ことをそのまま知らせて、続けるか聞く。

import { collectSharedCitationIds } from "../../blocks/shared-citation/collect";
import type { GraphiumDocument } from "../../lib/document-types";
import { findSharedFolderByRoot, sharedFolderLabel } from "../../lib/storage/shared";
import { getSharedLibrarySnapshot } from "./shared-library-store";

export type CrossFolderCitation = {
  /** 引用しているエントリがある共有フォルダのパス */
  root: string;
  /** そのフォルダの表示名（範囲） */
  label: string;
  /** そのフォルダにある引用の数 */
  count: number;
};

/**
 * doc が引用している共有エントリのうち、targetRoot 以外の共有フォルダにあるものを数える。
 * 置き場所が分からない引用（一覧に無い・共有解除済み）は数えない（どこにあるか言えないので）。
 * 結果はフォルダの登録順（スナップショットの roots 順）。
 */
export function findCrossFolderCitations(
  doc: Pick<GraphiumDocument, "pages">,
  targetRoot: string,
  entryRoots: Record<string, string> = getSharedLibrarySnapshot().entryRoots,
  roots: string[] = getSharedLibrarySnapshot().roots,
): CrossFolderCitation[] {
  const ids = new Set<string>();
  for (const page of doc.pages ?? []) {
    for (const id of collectSharedCitationIds((page as { blocks?: unknown }).blocks)) ids.add(id);
  }
  const counts = new Map<string, number>();
  for (const id of ids) {
    const root = entryRoots[id];
    if (!root || root === targetRoot) continue;
    counts.set(root, (counts.get(root) ?? 0) + 1);
  }
  const order = (r: string) => {
    const i = roots.indexOf(r);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...counts.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]))
    .map(([root, count]) => {
      const folder = findSharedFolderByRoot(root);
      return { root, count, label: folder ? sharedFolderLabel(folder) : sharedFolderLabel({ name: "", root }) };
    });
}

type Translate = (key: string, vars?: Record<string, string>) => string;

/** 警告文（確認ダイアログの本文）。テストからも使う */
export function crossFolderWarningText(cross: CrossFolderCitation[], targetRoot: string, t: Translate): string {
  const target = findSharedFolderByRoot(targetRoot);
  const targetLabel = target ? sharedFolderLabel(target) : sharedFolderLabel({ name: "", root: targetRoot });
  const list = cross
    .map((c) => t("share.crossFolder.item", { name: c.label, count: String(c.count) }))
    .join(t("share.crossFolder.separator"));
  return t("share.crossFolder.confirm", { target: targetLabel, list });
}

/**
 * 違うフォルダにあるものを引用していれば、続けるか聞く。引用が無ければ聞かずに true。
 * 共有フォルダが 1 件の人は cross が必ず空なので、何も変わらない。
 */
export function confirmCrossFolderCitations(
  cross: CrossFolderCitation[],
  targetRoot: string,
  t: Translate,
  confirm: (message: string) => boolean = (m) => window.confirm(m),
): boolean {
  if (cross.length === 0) return true;
  return confirm(crossFolderWarningText(cross, targetRoot, t));
}
