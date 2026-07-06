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

import { buildKnowledgeMap } from "../navigation/index-file";
import type { GraphiumIndex, NoteIndexEntry } from "../navigation/index-file";
import type { WikiLogEntry } from "../wiki/wiki-log";
import type { DiscoveryCard } from "./types";
import { t } from "../../i18n";

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
      title: t("composer.discovery.clarifyTitle"),
      hint: t("composer.discovery.clarifyHint"),
      action: { kind: "custom", key: "clarify-wiki" },
    };
  }
  return {
    id: `base-summarize-${entry.noteId}`,
    title: t("composer.discovery.summarizeTitle"),
    hint: t("composer.discovery.summarizeHint"),
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
      case "ingest":      hint = t("composer.discovery.hintIngest"); break;
      case "cross-update": hint = t("composer.discovery.hintCrossUpdate"); break;
      case "regenerate":  hint = t("composer.discovery.hintRegenerate"); break;
      case "merge":       hint = t("composer.discovery.hintMerge"); break;
      default:
        // lint, delete はカード化しない
        continue;
    }
    cards.push({
      id: `log-${e.id}`,
      title: t("composer.discovery.tellMeAbout", { title: wikiTitle }),
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
    title: t("composer.discovery.tellMeAbout", { title: n.title }),
    hint: t("composer.discovery.editedNoteHint", { time: formatRelativeTime(n.modifiedAt, now) }),
    action: { kind: "custom", key: `note:${n.noteId}` },
  }));
}

function formatRelativeTime(iso: string, now: Date): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  if (hours < 1) return t("composer.discovery.timeNow");
  if (hours < 24) return t("composer.discovery.timeHoursAgo", { hours: String(hours) });
  const days = Math.floor(hours / 24);
  return t("composer.discovery.timeDaysAgo", { days: String(days) });
}

/** 現ノートが未 ingest なら「Knowledge に追加」を高優先で 1 枚。
 * Wiki / skill ドキュメント自身、または既に派生 wiki が存在するノートでは出さない。 */
function ingestCardForActiveNote(
  noteIndex: GraphiumIndex | null,
  activeFileId: string | null,
): DiscoveryCard | null {
  if (!activeFileId || !noteIndex) return null;
  if (activeFileId.startsWith("wiki:") || activeFileId.startsWith("skill:")) return null;
  const entry = findActiveEntry(noteIndex, activeFileId);
  if (!entry) return null;
  if (entry.source === "ai" || entry.source === "skill") return null;
  const knowledgeMap = buildKnowledgeMap(noteIndex);
  if ((knowledgeMap.get(entry.noteId)?.length ?? 0) > 0) return null;
  return {
    id: `ingest-${entry.noteId}`,
    title: t("composer.discovery.ingestTitle"),
    hint: t("composer.discovery.ingestHint"),
    action: { kind: "custom", key: "ingest-current-note" },
  };
}

/**
 * 現在の文脈から発見カードを最大 4 枚組み立てる。
 * 文脈が乏しい（ノート未選択 + ログなし）場合は空配列を返す。
 */
export function buildDiscoveryCards(ctx: DiscoveryCardContext): DiscoveryCard[] {
  const now = ctx.now ?? new Date();
  const cards: DiscoveryCard[] = [];

  // 0. 現ノートが未 ingest なら「Knowledge に追加」を最優先で
  const ingestCard = ingestCardForActiveNote(ctx.noteIndex, ctx.activeFileId);
  if (ingestCard) cards.push(ingestCard);

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
      return t("composer.discovery.promptSummarize");
    case "continue-writing":
      return t("composer.discovery.promptContinue");
    case "visualize-prov":
      return t("composer.discovery.promptVisualizeProv");
    case "make-concept-wiki":
      return t("composer.discovery.promptConceptWiki");
    case "custom":
      // custom 内のキーで分岐
      if (card.action.key === "ingest-current-note") {
        // この key は呼び出し側で即座に enqueueIngest を発火するため、
        // 入力欄に流し込む文字列は使われない。空でよい。
        return "";
      }
      if (card.action.key === "clarify-wiki") {
        return t("composer.discovery.promptClarify");
      }
      if (card.action.key.startsWith("wiki:") || card.action.key.startsWith("note:")) {
        // タイトル文言（ja: 「<タイトル>」について教えて / en: Tell me about "<title>"）から
        // タイトル部分を取り出し、prompt 用の文言に組み替える
        const m = card.title.match(/「(.+?)」|"(.+?)"/);
        const name = m ? (m[1] ?? m[2]) : card.title;
        return t("composer.discovery.promptTellMeAbout", { title: name });
      }
      return card.title;
  }
}
