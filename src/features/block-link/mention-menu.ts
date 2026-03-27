// @ をトリガーの参照リンクオートコンプリート
// 知識層リンク（reference）を作成する

import type { ProvNoteFile } from "../../lib/google-drive";

// 参照候補の型
export type ReferenceSuggestion = {
  /** 候補の種類 */
  type: "heading" | "note";
  /** ブロック ID（同ノート内見出し）or ノートファイル ID */
  id: string;
  /** 表示名 */
  label: string;
  /** グループ名 */
  group: string;
};

/**
 * 同ノート内の見出しブロックを候補として収集する。
 * DOM から見出し要素を取得し、候補リストを構築する。
 * @param currentBlockId 現在のカーソルがあるブロック ID（自分自身を除外するため）
 */
export function getHeadingSuggestions(currentBlockId?: string): ReferenceSuggestion[] {
  const suggestions: ReferenceSuggestion[] = [];
  const headingEls = document.querySelectorAll('[data-node-type="blockOuter"]');

  headingEls.forEach((el) => {
    const blockId = el.getAttribute("data-id");
    if (!blockId || blockId === currentBlockId) return;

    // H1, H2, H3 を検出
    const h1 = el.querySelector("h1");
    const h2 = el.querySelector("h2");
    const h3 = el.querySelector("h3");
    const heading = h1 || h2 || h3;
    if (!heading) return;

    const text = heading.textContent?.trim() || "";
    if (!text) return;

    const level = h1 ? 1 : h2 ? 2 : 3;
    suggestions.push({
      type: "heading",
      id: blockId,
      label: `${"#".repeat(level)} ${text}`,
      group: "このノート",
    });
  });

  return suggestions;
}

/**
 * 他ノートの候補を構築する。
 * @param files Google Drive のファイル一覧
 * @param currentFileId 現在開いているファイル ID（除外用）
 */
export function getNoteSuggestions(
  files: ProvNoteFile[],
  currentFileId?: string,
): ReferenceSuggestion[] {
  return files
    .filter((f) => f.id !== currentFileId)
    .sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime())
    .slice(0, 20) // 最大20件
    .map((f) => ({
      type: "note" as const,
      id: f.id,
      label: f.name.replace(/\.provnote\.json$/, ""),
      group: "他のノート",
    }));
}
