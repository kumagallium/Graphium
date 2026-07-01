// @ をトリガーの参照リンクオートコンプリート
// 知識層リンク（reference）を作成する

import type { GraphiumFile } from "../../lib/document-types";
import type { GraphiumIndex } from "../navigation/index-file";
import type { MediaIndex } from "../asset-browser/media-index";

// 参照候補の型
export type ReferenceSuggestion = {
  /** 候補の種類。"asset" は取り込んだドキュメント素材（PDF/docx）本体を指す */
  type: "heading" | "note" | "asset";
  /** ブロック ID（同ノート内見出し）/ ノートファイル ID / 素材 fileId */
  id: string;
  /** 表示名 */
  label: string;
  /** グループ名 */
  group: string;
  /**
   * 補助表示（2 行目）。同名ノートが複数あるときだけ更新日を入れて区別できるようにする。
   * shadcn の SuggestionMenu.Item が item.subtext をそのまま描画する。
   */
  subtext?: string;
};

/**
 * modifiedAt(ISO) を YYYY-MM-DD HH:mm（ローカル日時）に整形する。不正値は空文字。
 * 同名ノートは同じ日に作られることが多いので、日付だけでは区別しづらい。時刻まで出す。
 */
export function formatMentionDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

/**
 * 候補リスト中で「実タイトルが重複しているノート」だけに更新日の subtext を付与する。
 * 一意なタイトルには付けない（メニューを無駄にうるさくしないため）。
 */
function attachDuplicateSubtext(
  items: { suggestion: ReferenceSuggestion; title: string; modifiedAt: string }[],
): void {
  const titleCount = new Map<string, number>();
  for (const it of items) {
    titleCount.set(it.title, (titleCount.get(it.title) ?? 0) + 1);
  }
  for (const it of items) {
    if ((titleCount.get(it.title) ?? 0) > 1) {
      const date = formatMentionDate(it.modifiedAt);
      if (date) it.suggestion.subtext = date;
    }
  }
}

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
 * インデックスがあればそこから取得（見出し付き）、なければ files から取得。
 * @param files Google Drive のファイル一覧
 * @param currentFileId 現在開いているファイル ID（除外用）
 * @param noteIndex インデックスファイル（オプション）
 */
export function getNoteSuggestions(
  files: GraphiumFile[],
  currentFileId?: string,
  noteIndex?: GraphiumIndex | null,
): ReferenceSuggestion[] {
  // 同名ノートを区別するための subtext 付与に使う (suggestion, 実タイトル, modifiedAt) の組
  const entries: { suggestion: ReferenceSuggestion; title: string; modifiedAt: string }[] = [];

  // インデックスがあればノート + Wiki の候補を返す
  if (noteIndex) {
    const suggestions: ReferenceSuggestion[] = [];

    // 人間のノート
    const notes = noteIndex.notes
      .filter((n) => n.noteId !== currentFileId && n.source !== "ai")
      .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())
      .slice(0, 25);

    for (const note of notes) {
      const s: ReferenceSuggestion = {
        type: "note",
        id: note.noteId,
        label: note.title,
        group: "他のノート",
      };
      suggestions.push(s);
      entries.push({ suggestion: s, title: note.title, modifiedAt: note.modifiedAt });
    }

    // Wiki ドキュメント（🤖 アイコンで区別）
    const wikis = noteIndex.notes
      .filter((n) => n.source === "ai")
      .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())
      .slice(0, 10);

    for (const wiki of wikis) {
      const kindPrefix = wiki.wikiKind === "summary" ? "Summary" : "Concept";
      const s: ReferenceSuggestion = {
        type: "note",
        id: wiki.noteId,
        label: `🤖 ${kindPrefix}: ${wiki.title}`,
        group: "AI Knowledge",
      };
      suggestions.push(s);
      entries.push({ suggestion: s, title: wiki.title, modifiedAt: wiki.modifiedAt });
    }

    // 実タイトルが重複するものだけ更新日を添えて区別できるようにする
    attachDuplicateSubtext(entries);
    return suggestions;
  }

  // フォールバック: files から取得
  const suggestions: ReferenceSuggestion[] = files
    .filter((f) => f.id !== currentFileId)
    .sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime())
    .slice(0, 20)
    .map((f) => {
      const title = f.name.replace(/\.(graphium|provnote)\.json$/, "");
      const s: ReferenceSuggestion = {
        type: "note",
        id: f.id,
        label: title,
        group: "他のノート",
      };
      entries.push({ suggestion: s, title, modifiedAt: f.modifiedTime });
      return s;
    });
  attachDuplicateSubtext(entries);
  return suggestions;
}

/**
 * 取り込んだドキュメント素材（PDF / docx 等）を @ 候補として収集する。
 * ノート由来ではなく「素材そのもの」を引用したい場合（論文 PDF の引用等）に使う。
 * 選択すると本文に @素材名 を挿入し、doc.citedAssetFileIds に fileId を記録する。
 */
export function getAssetSuggestions(mediaIndex?: MediaIndex | null): ReferenceSuggestion[] {
  if (!mediaIndex) return [];
  return mediaIndex.media
    .filter((m) => m.type === "pdf" || m.type === "document")
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
    .slice(0, 15)
    .map((m) => ({
      type: "asset" as const,
      id: m.fileId,
      label: `📄 ${m.name}`,
      group: "ドキュメント素材",
    }));
}
