// Composer 中段の発見カードを動的生成する純関数
// 入力: noteIndex（全ノート一覧）+ wikiLog の直近イベント + 現在開いているノート
// 出力: DiscoveryCard[]（最大 4 枚）
//
// 実装方針:
//   1. 現在のノートを基にしたベースカード（必ず 1 枚）
//   2. 直近 7 日の wikiLog から動的提案（ingest / cross-update / regenerate / merge）
//   3. 直近 7 日に更新された他のノートから「@N について」提案
//   4. 全部足して 4 枚を超えたら優先度順に切る
//
// ロジック自体は副作用なし。呼び出し側で wikiLog.getRecent() を非同期で取得して渡す。

import type { GraphiumIndex, NoteIndexEntry } from "../navigation/index-file";
import type { WikiLogEntry } from "../wiki/wiki-log";
import type { DiscoveryCard } from "./types";

const MAX_CARDS = 4;
const RECENT_DAYS = 7;

export type DiscoveryCardContext = {
  noteIndex: GraphiumIndex | null;
  activeFileId: string | null;
  wikiLogEntries: WikiLogEntry[];
  now?: Date;
};

/** 直近 7 日以内の ISO timestamp を保持しているか */
function isWithinRecentDays(iso: string, now: Date): boolean {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  const cutoff = now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000;
  return t >= cutoff;
}

/** activeFileId は Wiki ドキュメントの場合 "wiki:<id>" プレフィックス付きで来る。
   noteIndex.notes の noteId は plain なので、両形式で照合する。 */
function findActiveEntry(
  noteIndex: GraphiumIndex,
  activeFileId: string,
): NoteIndexEntry | undefined {
  const plainId = activeFileId.replace(/^wiki:/, "");
  return noteIndex.notes.find((n) => n.noteId === plainId || n.noteId === activeFileId);
}

/** 現在のノートに紐づくベースカードを返す（ノートが開かれていれば 1 枚） */
function baseCardForActiveNote(
  noteIndex: GraphiumIndex | null,
  activeFileId: string | null,
): DiscoveryCard | null {
  if (!activeFileId || !noteIndex) return null;
  const entry = findActiveEntry(noteIndex, activeFileId);
  if (!entry) return null;
  // 人間ノートなら「要約」、Wiki ドキュメントなら「概念整理」
  if (entry.source === "ai") {
    return {
      id: `base-clarify-${entry.noteId}`,
      title: "この Wiki を整理する",
      hint: "矛盾や繰り返しを洗い出して書き直すヒントをもらう",
      action: { kind: "custom", key: "clarify-wiki" },
    };
  }
  return {
    id: `base-summarize-${entry.noteId}`,
    title: "このノートを要約する",
    hint: "見出し単位で 3 行にまとめる",
    action: { kind: "summarize-note" },
  };
}

/** noteIndex から wiki タイトルを引く。見つからない（古い・既削除）時は null。 */
function lookupWikiTitle(
  noteIndex: GraphiumIndex | null,
  wikiId: string,
): string | null {
  if (!noteIndex) return null;
  const e = noteIndex.notes.find((n) => n.noteId === wikiId);
  return e?.title ?? null;
}

/** wikiLog の直近イベントから候補カードを生成（重複ノート ID は最初の 1 つだけ）
   wiki のタイトルが取れる場合のみカード化する（取れない＝古いログ・削除済みは捨てる） */
function cardsFromWikiLog(
  entries: WikiLogEntry[],
  now: Date,
  noteIndex: GraphiumIndex | null,
): DiscoveryCard[] {
  const cards: DiscoveryCard[] = [];
  const seenWikiIds = new Set<string>();

  for (const e of entries) {
    if (!isWithinRecentDays(e.timestamp, now)) continue;
    const wikiId = e.wikiIds[0];
    if (!wikiId || seenWikiIds.has(wikiId)) continue;
    seenWikiIds.add(wikiId);

    const wikiTitle = lookupWikiTitle(noteIndex, wikiId);
    if (!wikiTitle) continue; // タイトル不明の wiki はカード化しない（重複感の元）

    // タイトルはクリック後の prompt と齟齬がないよう「について教えて」型で統一。
    // 直近のイベント種別は hint 側で補足する。
    let hint: string | undefined;
    switch (e.type) {
      case "ingest":      hint = "最近作られた Wiki"; break;
      case "cross-update": hint = "他ノートとの横断更新の提案"; break;
      case "regenerate":  hint = "別モデルでの再生成結果"; break;
      case "merge":       hint = "複数ノートを統合した Synthesis"; break;
      default:
        // lint, delete はカード化しない
        continue;
    }
    cards.push({
      id: `log-${e.id}`,
      title: `「${wikiTitle}」について教えて`,
      hint,
      action: { kind: "custom", key: `wiki:${wikiId}` },
    });
  }
  return cards;
}

/** noteIndex から直近 7 日に更新されたノートを上位 N 件取得（自分自身は除外） */
function recentNoteCards(
  noteIndex: GraphiumIndex | null,
  activeFileId: string | null,
  now: Date,
  limit: number,
): DiscoveryCard[] {
  if (!noteIndex || limit <= 0) return [];
  const sorted = noteIndex.notes
    .filter((n): n is NoteIndexEntry =>
      n.noteId !== activeFileId &&
      n.source !== "ai" &&
      n.source !== "skill" &&
      isWithinRecentDays(n.modifiedAt, now),
    )
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    .slice(0, limit);

  return sorted.map((n) => ({
    id: `recent-${n.noteId}`,
    title: `「${n.title}」について教えて`,
    hint: `${formatRelativeTime(n.modifiedAt, now)}に編集したノート`,
    action: { kind: "custom", key: `note:${n.noteId}` },
  }));
}

function formatRelativeTime(iso: string, now: Date): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  if (hours < 1) return "今";
  if (hours < 24) return `${hours}h 前`;
  const days = Math.floor(hours / 24);
  return `${days}d 前`;
}

/**
 * 現在の文脈から発見カードを最大 4 枚組み立てる。
 * 文脈が乏しい（ノート未選択 + ログなし）場合は空配列を返す。
 */
export function buildDiscoveryCards(ctx: DiscoveryCardContext): DiscoveryCard[] {
  const now = ctx.now ?? new Date();
  const cards: DiscoveryCard[] = [];

  // 1. ベースカード（現ノート）
  const base = baseCardForActiveNote(ctx.noteIndex, ctx.activeFileId);
  if (base) cards.push(base);

  // 2. wikiLog 由来のカード（直近 7 日、wiki タイトルが引ければ採用）
  const fromLog = cardsFromWikiLog(ctx.wikiLogEntries, now, ctx.noteIndex);
  for (const c of fromLog) {
    if (cards.length >= MAX_CARDS) break;
    cards.push(c);
  }

  // 3. 直近更新ノート（埋めるため）
  const remaining = MAX_CARDS - cards.length;
  if (remaining > 0) {
    const fromNotes = recentNoteCards(ctx.noteIndex, ctx.activeFileId, now, remaining);
    cards.push(...fromNotes);
  }

  return cards.slice(0, MAX_CARDS);
}

/** カードクリック時に Composer の prompt に流し込む文字列を組み立てる */
export function promptForDiscoveryCard(card: DiscoveryCard): string {
  switch (card.action.kind) {
    case "summarize-note":
      return "このノートを見出し単位で 3 行にまとめてください。";
    case "continue-writing":
      return "直前の段落を踏まえて、続きを 1〜2 段落書いてください。";
    case "visualize-prov":
      return "このノートの来歴グラフ（PROV-DM）を可視化してください。";
    case "make-concept-wiki":
      return "頻出キーワードから Concept Wiki の下書きを作ってください。";
    case "custom":
      // custom 内のキーで分岐
      if (card.action.key === "clarify-wiki") {
        return "この Wiki の矛盾・繰り返しを洗い出し、書き直しのヒントをください。";
      }
      if (card.action.key.startsWith("wiki:") || card.action.key.startsWith("note:")) {
        // 「<タイトル>」について教えて → 「<タイトル>」について教えてください。
        const m = card.title.match(/「(.+?)」/);
        const name = m ? m[1] : card.title;
        return `「${name}」について教えてください。`;
      }
      return card.title;
  }
}
