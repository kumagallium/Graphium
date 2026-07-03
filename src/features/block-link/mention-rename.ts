// ──────────────────────────────────────────────
// @メンションのラベル追従（タイトルリネーム伝播）
//
// メンションは本文上「@タイトル」の青文字テキスト（挿入時のスナップショット）として
// 保存され、ノート ID はリンクレコード（provLinks / knowledgeLinks の targetNoteId）
// 側にしか無い。そのためタイトルを変更しても参照元のラベルは自動では変わらない。
// このモジュールは、参照元ノートのラベルを新タイトルへ書き換えるための純関数群。
// ファイル IO・state 更新は呼び出し側（use-file-manager / note-app）が担う。
// ──────────────────────────────────────────────

import type { GraphiumDocument } from "../../lib/document-types";

type InlineRun = {
  type?: string;
  text?: string;
  styles?: Record<string, string>;
  /** type: "link" run の内側コンテンツ */
  content?: InlineRun[];
  href?: string;
};

/**
 * インラインコンテンツ内のメンション run（青文字で text が「@旧タイトル」に完全一致）を
 * 「@新タイトル」に置き換える。1 つも置き換わらなければ null を返す（保存不要の判定用）。
 * type: "link" run の内側（content）にも同じ規則で再帰する。
 *
 * 完全一致に限定する理由: 部分一致は本文中の偶然の文字列（青文字装飾で @旧タイトル を
 * 含む文など）を誤って書き換えるリスクがあるため。メンションは挿入時に「@タイトル」
 * 単独 run + 半角スペースの形で入る（insertNoteMentionInline）ので完全一致で拾える。
 */
export function replaceMentionRunsInContent(
  content: unknown,
  oldTitle: string,
  newTitle: string,
): InlineRun[] | null {
  if (!Array.isArray(content)) return null;
  const target = `@${oldTitle}`;
  let changed = false;
  const next = (content as InlineRun[]).map((run) => {
    if (
      run?.type === "text" &&
      run.text === target &&
      run.styles?.textColor === "blue"
    ) {
      changed = true;
      return { ...run, text: `@${newTitle}` };
    }
    if (run?.type === "link" && Array.isArray(run.content)) {
      const inner = replaceMentionRunsInContent(run.content, oldTitle, newTitle);
      if (inner) {
        changed = true;
        return { ...run, content: inner };
      }
    }
    return run;
  });
  return changed ? next : null;
}

export type MentionRenameResult = {
  doc: GraphiumDocument;
  /** ラベルを書き換えたブロック ID（ライブエディタへの反映用） */
  changedBlockIds: string[];
};

/**
 * 参照元ノートの doc に対して、renamedNoteId へのメンションラベルを newTitle へ追従させる。
 *
 * - 対象ブロックはリンクレコード（provLinks / knowledgeLinks / v1 互換 links）の
 *   targetNoteId === renamedNoteId で特定する。タイトル文字列だけに頼らないので、
 *   同名の別ノートを誤って書き換えない。
 * - 同名曖昧ガード: 同じブロックに「別ノートだが現在のタイトルが oldTitle と同じ」参照が
 *   同居している場合、どの「@旧タイトル」がどちらを指すか run 単位では判別できないため、
 *   そのブロックには触らない（誤った付け替えより不追従を選ぶ）。
 * - 何も変わらなければ null（保存不要）。
 */
export function applyMentionRenameToDoc(
  doc: GraphiumDocument,
  renamedNoteId: string,
  oldTitle: string,
  newTitle: string,
  resolveCurrentTitle: (noteId: string) => string | undefined,
): MentionRenameResult | null {
  if (!oldTitle || !newTitle || oldTitle === newTitle) return null;
  const page = doc.pages?.[0];
  if (!page) return null;
  const links: Array<{ sourceBlockId?: string; targetNoteId?: string }> = [
    ...(page.provLinks ?? []),
    ...(page.knowledgeLinks ?? []),
    ...(page.links ?? []),
  ];
  const targetBlockIds = new Set<string>();
  for (const l of links) {
    if (l?.targetNoteId === renamedNoteId && l.sourceBlockId) {
      targetBlockIds.add(l.sourceBlockId);
    }
  }
  if (targetBlockIds.size === 0) return null;

  // 同名曖昧ガード
  for (const l of links) {
    if (!l?.sourceBlockId || !targetBlockIds.has(l.sourceBlockId)) continue;
    if (
      l.targetNoteId &&
      l.targetNoteId !== renamedNoteId &&
      resolveCurrentTitle(l.targetNoteId) === oldTitle
    ) {
      targetBlockIds.delete(l.sourceBlockId);
    }
  }
  if (targetBlockIds.size === 0) return null;

  const changedBlockIds: string[] = [];
  const mapBlocks = (blocks: any[]): any[] => {
    let anyChanged = false;
    const next = blocks.map((b) => {
      let nb = b;
      if (b?.id && targetBlockIds.has(b.id)) {
        const nc = replaceMentionRunsInContent(b.content, oldTitle, newTitle);
        if (nc) {
          nb = { ...nb, content: nc };
          changedBlockIds.push(b.id);
        }
      }
      if (Array.isArray(b?.children) && b.children.length > 0) {
        const nch = mapBlocks(b.children);
        if (nch !== b.children) {
          nb = nb === b ? { ...b, children: nch } : { ...nb, children: nch };
        }
      }
      if (nb !== b) anyChanged = true;
      return nb;
    });
    return anyChanged ? next : blocks;
  };

  const newBlocks = mapBlocks(page.blocks ?? []);
  if (changedBlockIds.length === 0) return null;
  return {
    doc: {
      ...doc,
      pages: [{ ...page, blocks: newBlocks }, ...doc.pages.slice(1)],
      modifiedAt: new Date().toISOString(),
    },
    changedBlockIds,
  };
}
