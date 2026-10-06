// check_knowledge の本体: ナレッジ層（wiki/）の点検のうち、機械で判定できる分だけを行う。
//
// Graphium の点検（wiki-linter.ts）の純関数 detectLocalIssues / detectMissingSourceIssues /
// detectAutoArchivable をそのまま使う。入力の WikiSnapshot は wiki-service の buildWikiSnapshots と
// 同じ組み方でファイルから作る（アプリ側はキャッシュ済みドキュメントを使うが、ここは本体 JSON を読む）。
// LLM を使う判定（古い・穴・意味的な重複）は行わない。英語の suggestion は返さず、日本語の短い説明を
// issue.type と affectedWikiIds から組む。

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

import type { GraphiumDocument } from "../lib/document-types";
import {
  detectAutoArchivable,
  detectLocalIssues,
  detectMissingSourceIssues,
  type AutoArchiveCandidate,
  type LintIssue,
  type WikiSnapshot,
} from "../server/services/wiki-linter";
import { noteToMarkdown } from "./note-text";
import { notesDir, readNote, readNoteIndex, resolveGraphiumRoot, scanUnlistedDocuments, wikiDir } from "./vault";

const BODY_PREVIEW_CHARS = 240;

const SNAPSHOT_KINDS = new Set(["summary", "claim", "atom", "synthesis", "topic", "answer"]);

/** 点検の対象にするページ id（索引の有効な AI ページ + 索引に載っていない wiki/ のファイル）と、有効なノート id */
export function listKnowledgeTargets(root: string): { wikiIds: string[]; validNoteIds: Set<string> } {
  const index = readNoteIndex(root);
  const listed = new Set(index?.notes.map((n) => n.noteId));
  const unlisted = scanUnlistedDocuments(listed, root);

  const wikiIds: string[] = [];
  const validNoteIds = new Set<string>();
  for (const n of index?.notes ?? []) {
    if (n.deletedAt || n.archivedAt || n.source === "skill") continue;
    if (n.source === "ai") wikiIds.push(n.noteId);
    else validNoteIds.add(n.noteId);
  }
  for (const n of unlisted) {
    if (n.source === "ai") wikiIds.push(n.noteId);
    else validNoteIds.add(n.noteId);
  }
  return { wikiIds, validNoteIds };
}

function fileMtimeIso(id: string, root: string): string {
  for (const dir of [notesDir(root), wikiDir(root)]) {
    const p = join(dir, `${id}.json`);
    if (!existsSync(p)) continue;
    try {
      return statSync(p).mtime.toISOString();
    } catch {
      break;
    }
  }
  return "";
}

/** 知見の knowledgeLinks（reference）の行き先 id。detectLocalIssues が参照の有無に使う */
function relatedClaimsOf(doc: GraphiumDocument): string[] {
  const out: string[] = [];
  for (const link of doc.pages?.[0]?.knowledgeLinks ?? []) {
    if (link.targetNoteId && link.type === "reference") out.push(link.targetNoteId);
  }
  return out;
}

/** ファイルから WikiSnapshot を 1 件組む（buildWikiSnapshots と同じ項目）。wikiMeta が無ければ null */
export function buildSnapshot(id: string, doc: GraphiumDocument, modifiedAt: string): WikiSnapshot | null {
  const meta = doc.wikiMeta;
  if (!meta || !SNAPSHOT_KINDS.has(meta.kind)) return null;
  const kind = meta.kind as WikiSnapshot["kind"];
  return {
    id,
    title: doc.title ?? "(untitled)",
    kind,
    derivedFromNotes: meta.derivedFromNotes ?? [],
    relatedClaims: relatedClaimsOf(doc),
    bodyPreview: noteToMarkdown(doc, { scripts: false }).slice(0, BODY_PREVIEW_CHARS),
    level: kind === "claim" ? meta.level : undefined,
    // topic / answer のメンバー知見（空かどうかが「空のページ」の判定になる）
    derivedFromClaims: kind === "topic" || kind === "answer" ? (meta.derivedFromClaims ?? []) : undefined,
    conflictsWith: kind === "atom" ? meta.conflictsWith : undefined,
    shape: kind === "atom" ? meta.shape : undefined,
    lastIngestedAt: meta.lastIngestedAt,
    modifiedAt,
  };
}

export function buildSnapshots(root: string, wikiIds: string[]): WikiSnapshot[] {
  const out: WikiSnapshot[] = [];
  for (const id of wikiIds) {
    const doc = readNote(id, root);
    if (!doc) continue;
    const snap = buildSnapshot(id, doc, fileMtimeIso(id, root));
    if (snap) out.push(snap);
  }
  return out;
}

const KIND_LABEL: Record<string, string> = {
  topic: "トピック",
  answer: "回答",
  claim: "知見",
  atom: "洞察",
  summary: "要約",
  synthesis: "統合",
};

const ARCHIVE_REASON: Record<AutoArchiveCandidate["reason"], string> = {
  "empty-topic": "資料も知見も 1 件も無い空のページです",
  "orphaned-source": "出どころのノートがすべて無くなっています",
  "sources-gone": "引いている資料（ノート）がすべて無くなっています",
};

type Line = { id: string; title: string; text: string };

/** 点検の結果をまとめて文字列にする */
export function checkKnowledge(root = resolveGraphiumRoot()): string {
  const { wikiIds, validNoteIds } = listKnowledgeTargets(root);
  const snapshots = buildSnapshots(root, wikiIds);
  if (snapshots.length === 0) {
    return "点検するナレッジのページがありません（トピック・知見・回答などはまだ作られていません）。";
  }
  const byId = new Map(snapshots.map((s) => [s.id, s]));
  const titleOf = (id: string) => byId.get(id)?.title ?? id;
  const labelOf = (id: string) => KIND_LABEL[byId.get(id)?.kind ?? ""] ?? "ページ";

  const local = detectLocalIssues(snapshots);
  const canJudgeNotes = validNoteIds.size > 0;
  const missing: LintIssue[] = canJudgeNotes ? detectMissingSourceIssues(snapshots, validNoteIds) : [];
  const archivable = canJudgeNotes ? detectAutoArchivable(snapshots, validNoteIds) : [];

  const orphans: Line[] = [];
  const empties: Line[] = [];
  const duplicates: Line[] = [];
  const contradictions: Line[] = [];
  const missingSources: Line[] = [];

  for (const issue of local) {
    const ids = issue.affectedWikiIds;
    const first = ids[0];
    switch (issue.type) {
      case "orphan": {
        const kind = byId.get(first)?.kind;
        if (kind === "topic" || kind === "answer") {
          empties.push({ id: first, title: titleOf(first), text: `${labelOf(first)}に資料も知見も 1 件も紐づいていません` });
        } else {
          orphans.push({ id: first, title: titleOf(first), text: "他のページにも元のノートにも、つながりがありません" });
        }
        break;
      }
      case "redundant": {
        const [keep, absorb] = ids;
        duplicates.push({
          id: `${keep} / ${absorb}`,
          title: `${titleOf(keep)} / ${titleOf(absorb)}`,
          text: `同じ名前のトピックが 2 つあります（残す候補: keepId ${keep}、まとめる側: ${absorb}）`,
        });
        break;
      }
      case "contradiction": {
        const [a, b] = ids;
        contradictions.push({
          id: `${a} / ${b}`,
          title: `${titleOf(a)} / ${titleOf(b)}`,
          text: "この 2 つの洞察は、発見時に矛盾すると判定され、どちらも残されています。見比べてどちらが成り立つか決めてください",
        });
        break;
      }
      default:
        break;
    }
  }
  for (const issue of missing) {
    const id = issue.affectedWikiIds[0];
    const snap = byId.get(id);
    const notes = (snap?.derivedFromNotes ?? []).filter((s) => !s.includes(":"));
    const gone = notes.filter((n) => !validNoteIds.has(n)).length;
    missingSources.push({
      id,
      title: titleOf(id),
      text: `引いているノート ${notes.length} 件のうち ${gone} 件がゴミ箱か見つからない状態です`,
    });
  }

  const section = (heading: string, lines: Line[]): string[] =>
    lines.length === 0
      ? []
      : [`## ${heading}（${lines.length} 件）`, ...lines.map((l) => `- ${l.title}  [id: ${l.id}]\n    ${l.text}`), ""];

  const out: string[] = [
    `# ナレッジの点検（機械判定）— ${snapshots.length} ページを確認`,
    "",
    ...section("孤立", orphans),
    ...section("空のページ", empties),
    ...section("同名の重複", duplicates),
    ...section("矛盾の印", contradictions),
  ];
  if (canJudgeNotes) {
    out.push(...section("資料の欠落", missingSources));
    out.push(
      ...section(
        "自動アーカイブ候補",
        archivable.map((c) => ({
          id: c.id,
          title: c.title,
          text: `${KIND_LABEL[c.kind] ?? "ページ"}: ${ARCHIVE_REASON[c.reason]}`,
        })),
      ),
    );
  } else {
    out.push("## 資料の欠落・自動アーカイブ候補", "判定できません（ノートが見つからないため、資料が残っているかを確かめられません）", "");
  }
  const found =
    orphans.length + empties.length + duplicates.length + contradictions.length + missingSources.length + archivable.length;
  if (found === 0) out.push("機械で判定できる問題は見つかりませんでした。", "");

  out.push(
    "重複は merge_topics でまとめられます。不要なページは archive_page でしまえます。",
    "古さ・穴・意味的な重複の判定（AI を使う点検）は Graphium の手入れ画面で行えます。",
  );
  return out.join("\n");
}
