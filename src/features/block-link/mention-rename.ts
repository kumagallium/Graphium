// ──────────────────────────────────────────────
// @メンションのラベル追従（タイトルリネーム伝播）
//
// メンションは本文上「@タイトル」の青文字テキスト（挿入時のスナップショット）として
// 保存され、ノート ID はリンクレコード（provLinks / knowledgeLinks の targetNoteId）
// 側にしか無い。そのためタイトルを変更しても参照元のラベルは自動では変わらない。
// このモジュールは、参照元ノートのラベルを新タイトルへ書き換えるための純関数群。
// ファイル IO・state 更新は呼び出し側（use-file-manager / note-app）が担う。
//
// ラベルの形式は 2 系統ある:
// - 通常ノート / 引用ピッカー経由の wiki: `@タイトル`
// - `@` メニュー経由の wiki: `@🤖 Summary: タイトル` / `@🤖 Concept: タイトル`
//   （mention-menu.ts の formatWikiMentionLabel が唯一のフォーマット源）
// そのため置換は「from → to のパターン集合」で行う。
// ──────────────────────────────────────────────

import type { GraphiumDocument } from "../../lib/document-types";
import type { BlockLink } from "../../lib/block-link-types";
import { formatWikiMentionLabel } from "./mention-menu";

type InlineRun = {
  type?: string;
  text?: string;
  styles?: Record<string, string>;
  /** type: "link" run の内側コンテンツ */
  content?: InlineRun[];
  href?: string;
};

export type MentionPattern = {
  from: string;
  to: string;
  /** ラベルの装飾部（`@` / `@🤖 Summary: ` 等）。一意フォールバック時に、
   *  run の現在の装飾形式を保ったまま新タイトルへ書き換えるために使う。 */
  prefix: string;
};

/**
 * リネームに対応する置換パターン集合を組み立てる。
 * - 常に `@旧` → `@新`（通常ノートのメンション + 引用ピッカー経由の wiki 引用）
 * - includeWikiLabels 指定時は `@🤖 Summary: 旧` / `@🤖 Concept: 旧` も追加
 *   （`@` メニュー経由で挿入された wiki メンションの装飾付きラベル。挿入時点の
 *   kind が現在と異なる可能性を考慮し、kind を問わず両方をパターンに含める）
 */
export function buildMentionPatterns(
  oldTitle: string,
  newTitle: string,
  opts?: { includeWikiLabels?: boolean },
): MentionPattern[] {
  const patterns: MentionPattern[] = [
    { from: `@${oldTitle}`, to: `@${newTitle}`, prefix: "@" },
  ];
  if (opts?.includeWikiLabels) {
    for (const kind of ["summary", "concept"]) {
      const prefix = `@${formatWikiMentionLabel(kind, "")}`;
      patterns.push({
        from: `@${formatWikiMentionLabel(kind, oldTitle)}`,
        to: `@${formatWikiMentionLabel(kind, newTitle)}`,
        prefix,
      });
    }
  }
  return patterns;
}

/**
 * インラインコンテンツ内のメンション run（青文字で text がパターンの from に完全一致）を
 * to に置き換える。1 つも置き換わらなければ null を返す（保存不要の判定用）。
 * type: "link" run の内側（content）にも同じ規則で再帰する。
 *
 * 完全一致に限定する理由: 部分一致は本文中の偶然の文字列（青文字装飾で @旧タイトル を
 * 含む文など）を誤って書き換えるリスクがあるため。メンションは挿入時に「@ラベル」
 * 単独 run + 半角スペースの形で入る（insertNoteMentionInline）ので完全一致で拾える。
 */
export function replaceMentionRunsInContent(
  content: unknown,
  patterns: MentionPattern[],
): InlineRun[] | null {
  if (!Array.isArray(content) || patterns.length === 0) return null;
  let changed = false;
  const next = (content as InlineRun[]).map((run) => {
    if (run?.type === "text" && run.styles?.textColor === "blue" && run.text) {
      const hit = patterns.find((p) => p.from === run.text);
      if (hit) {
        changed = true;
        return { ...run, text: hit.to };
      }
    }
    if (run?.type === "link" && Array.isArray(run.content)) {
      const inner = replaceMentionRunsInContent(run.content, patterns);
      if (inner) {
        changed = true;
        return { ...run, content: inner };
      }
    }
    return run;
  });
  return changed ? next : null;
}

/**
 * 1 ブロック分のインラインコンテンツを書き換える。
 * 1) まずパターン完全一致で置換（replaceMentionRunsInContent）。
 * 2) 一致が無い場合、uniqueFallback が真（= このブロックのノート参照リンクが
 *    リネーム対象宛てのみ、と呼び出し側が判定済み）かつ青文字の `@` run が
 *    ちょうど 1 個なら、その run を新ラベルへ書き換える。
 *
 * (2) は「skip 等でラベルが旧世代のまま取り残された」メンションの自動修復。
 * 参照リンクが対象宛てのみ + 候補 run が 1 個なら、テキストが何世代前でも
 * その run が対象のメンションであることは一意に決まるので安全に書き換えられる。
 * 装飾（🤖 Summary/Concept:）は run の現在の形式（prefix 最長一致）を保つ。
 */
export function rewriteMentionRunsForBlock(
  content: unknown,
  patterns: MentionPattern[],
  opts?: { uniqueFallback?: boolean },
): InlineRun[] | null {
  const exact = replaceMentionRunsInContent(content, patterns);
  if (exact || !opts?.uniqueFallback || !Array.isArray(content)) return exact;
  const runs = content as InlineRun[];
  const candidateIdxs: number[] = [];
  runs.forEach((r, i) => {
    if (r?.type === "text" && r.styles?.textColor === "blue" && r.text?.startsWith("@")) {
      candidateIdxs.push(i);
    }
  });
  if (candidateIdxs.length !== 1) return null;
  const idx = candidateIdxs[0];
  const run = runs[idx];
  const byLongestPrefix = [...patterns].sort((a, b) => b.prefix.length - a.prefix.length);
  const pat = byLongestPrefix.find((p) => run.text!.startsWith(p.prefix)) ?? patterns[0];
  if (run.text === pat.to) return null; // 既に新ラベル
  const next = [...runs];
  next[idx] = { ...run, text: pat.to };
  return next;
}

export type MentionRenameResult = {
  doc: GraphiumDocument;
  /** ラベルを書き換えたブロック ID（ライブエディタへの反映用） */
  changedBlockIds: string[];
};

/**
 * 参照元ノートの doc に対して、renamedNoteId へのメンションラベルを newTitle へ追従させる。
 *
 * - renamedNoteId はプレフィックス無しの raw id（リンクレコードの targetNoteId と同じ形）。
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
  opts?: { includeWikiLabels?: boolean },
): MentionRenameResult | null {
  if (!oldTitle || !newTitle || oldTitle === newTitle) return null;
  const page = doc.pages?.[0];
  if (!page) return null;
  const links: Array<Pick<BlockLink, "sourceBlockId" | "targetNoteId">> = [
    ...(page.provLinks ?? []),
    ...(page.knowledgeLinks ?? []),
    ...(page.links ?? []),
  ];
  const targetBlockIds = new Set<string>();
  // ブロックごとのノート参照先集合（一意フォールバック判定用）
  const blockTargets = new Map<string, Set<string>>();
  for (const l of links) {
    if (!l?.sourceBlockId || !l.targetNoteId) continue;
    let set = blockTargets.get(l.sourceBlockId);
    if (!set) blockTargets.set(l.sourceBlockId, (set = new Set()));
    set.add(l.targetNoteId);
    if (l.targetNoteId === renamedNoteId) targetBlockIds.add(l.sourceBlockId);
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

  const patterns = buildMentionPatterns(oldTitle, newTitle, opts);
  const changedBlockIds: string[] = [];
  const mapBlocks = (blocks: any[]): any[] => {
    let anyChanged = false;
    const next = blocks.map((b) => {
      let nb = b;
      if (b?.id && targetBlockIds.has(b.id)) {
        const nc = rewriteMentionRunsForBlock(b.content, patterns, {
          // 参照リンクがリネーム対象宛てのみのブロックは、完全一致しない旧世代
          // ラベルも一意に特定できるため修復する
          uniqueFallback: blockTargets.get(b.id)?.size === 1,
        });
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
