// 手入れのツール（revise_topic / merge_topics / archive_page / restore_page / list_operations / undo_operation）。
// 仕様: docs/internal/mcp-upkeep-stage3-spec-2026-10.md §3
//
// 既存の読み書きツール（../tools.ts）とは分け、index.ts から registerUpkeepTools を呼ぶ。
// ハンドラ本体は「文字列を返す関数」として export し、単体テストは McpServer なしで呼ぶ。

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { GraphiumDocument } from "../../lib/document-types";
import {
  activeRunIds,
  beginMaintenanceRun,
  isMaintenanceSaveFailed,
} from "../../features/knowledge-maintenance/recorder";
import { loadRecentRuns, loadRunsFrom } from "../../features/knowledge-maintenance/run-store";
import {
  deriveOperationStates,
  findBlockingOperations,
  operationOrderTime,
  parseMaintenanceKey,
} from "../../features/knowledge-maintenance/run-format";
import { describeUndoImpact, undoMaintenanceOperation } from "../../features/knowledge-maintenance/undo";
import type { MaintenanceOperation } from "../../features/knowledge-maintenance/types";
import { buildNoteIndex, rebuildSourceBackedWikiDocument } from "../../features/wiki/wiki-service";
import type { TopicSourceRef } from "../../features/wiki/wiki-service";
import { resetSearchIndex } from "../search";
import type { ToolContext } from "../tools";
import { readNoteIndex, resolveGraphiumRoot, vaultExists, wikiDir } from "../vault";
import { agentLabelFor, buildActor, stampGeneratedBy } from "./actor";
import { createFsMaintenanceStorage } from "./fs-storage";
import {
  acquireWriteLock,
  appRunningMessage,
  detectRunningApp,
  type WriteLock,
} from "./guard";
import { createMcpMaintenanceHost } from "./host";
import { getFlags, readIndexStrict, setFlag } from "./index-store";
import { describeActorJa, describeOperationJa, describeRefusalJa, describeStateJa } from "./messages";
import { resolveSourceRefs } from "./source-refs";

// ── 共通部品 ────────────────────────────────────────────────

/** ツールの返り値（テキスト 1 本）を組む */
function text(body: string) {
  return { content: [{ type: "text" as const, text: body }] };
}

function vaultMissingMessage(root: string): string {
  return [
    `Graphium の vault が見つかりません: ${root}`,
    "",
    "GRAPHIUM_ROOT 環境変数で vault のルート（notes/ を含むディレクトリ）を指定してください。",
    "Graphium アプリを一度も起動していない場合は、先に起動してノートを 1 つ作ってください。",
  ].join("\n");
}

const STOPPED_MIDWAY =
  "Graphium が起動したため途中で止めました。Graphium を終了してもう一度お試しください。";

const KNOWLEDGE_KINDS = ["topic", "answer"];

/** wiki/ 直下のページだけを読む（readNote は notes/ を先に見るため使わない） */
function readWikiDoc(root: string, id: string): GraphiumDocument | null {
  if (!id || /[\\/]/.test(id) || id.includes("..")) return null;
  const path = join(wikiDir(root), `${id}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as GraphiumDocument;
  } catch {
    return null;
  }
}

function isNewFormat(doc: GraphiumDocument): boolean {
  return typeof doc.wikiMeta?.topicMarkdown === "string";
}

/**
 * 書き換え系の共通の前置き: vault → 索引 → 起動中か → ロック。
 * fn の成否にかかわらず最後にロックを解放する
 */
async function withWriteGuard(root: string, fn: (lock: WriteLock) => Promise<string>): Promise<string> {
  if (!vaultExists(root)) return vaultMissingMessage(root);
  const idx = readIndexStrict(root);
  if (!idx.ok) {
    return idx.code === "NO_INDEX"
      ? "NO_INDEX: Graphium を一度起動してください（note-index.json がありません）。"
      : "INDEX_UNREADABLE: note-index.json を読めません。Graphium を一度起動して索引を作り直してください。";
  }
  const running = await detectRunningApp(root);
  if (running.running) return appRunningMessage(running);
  const lock = await acquireWriteLock(root);
  if (!lock.ok) return lock.message;
  try {
    return await fn(lock);
  } finally {
    await lock.release().catch(() => undefined);
  }
}

/** 書く直前の再判定。起動していたら「途中で止めました」の文を返す */
async function stoppedIfRunning(root: string): Promise<string | null> {
  const r = await detectRunningApp(root);
  return r.running ? STOPPED_MIDWAY : null;
}

/** 資料 id を TopicSourceRef にする。解決できない id は title を id のまま使う（既存の資料用） */
function resolveLenient(ids: string[], root: string): TopicSourceRef[] {
  const { refs, missing } = resolveSourceRefs(ids, root);
  const byId = new Map<string, TopicSourceRef>(refs.map((r) => [r.id, r]));
  for (const m of missing) byId.set(m, { id: m, title: m });
  const out: TopicSourceRef[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const ref = byId.get(id);
    if (ref) out.push(ref);
  }
  return out;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const BODY_SOURCE_RE = /\[\[source:([^\]]+?)\]\]/g;

function unknownSourceMessage(ids: string[]): string {
  return `UNKNOWN_SOURCE: ${ids.join(", ")}（Graphium に存在しない資料です。search_media / get_topic で id を確かめてください）`;
}

/**
 * 本文の [[source:<id>]] のうち、資料一覧（refs）に無い id を厳密に解決して refs に足す。
 * 解決できないものは断る（rebuildSourceBackedWikiDocument は未知の id をそのまま残し、
 * derivedFromNotes にも入れないため）。lenientIds（ページの今の資料）は解決できなくても許す
 */
function addBodySourceRefs(
  body: string,
  refs: TopicSourceRef[],
  root: string,
  lenientIds: string[] = [],
): { ok: true; refs: TopicSourceRef[] } | { ok: false; message: string } {
  const have = new Set(refs.map((r) => r.id));
  const bodyIds = [...new Set([...body.matchAll(BODY_SOURCE_RE)].map((m) => m[1].trim()))].filter(
    (id) => id && !have.has(id),
  );
  if (bodyIds.length === 0) return { ok: true, refs };
  const { refs: found, missing } = resolveSourceRefs(bodyIds, root);
  const lenient = new Set(lenientIds);
  const bad = missing.filter((id) => !lenient.has(id));
  if (bad.length > 0) return { ok: false, message: unknownSourceMessage(bad) };
  const kept = missing.filter((id) => lenient.has(id)).map((id) => ({ id, title: id }));
  return { ok: true, refs: [...refs, ...found, ...kept] };
}

const NOT_RECORDED_MESSAGE =
  "NOT_RECORDED: 手入れの記録（appdata/maint-run-*）が書けないため中止しました。appdata フォルダの書き込み権限を確かめてください。";

/** 保存の失敗は host が覚えた原因を添える */
function failureMessage(prefix: string, e: unknown, host: { lastSaveError(): string | null }): string {
  if (isMaintenanceSaveFailed(e)) {
    const cause = host.lastSaveError();
    return cause ? `保存に失敗しました: ${cause}` : `${prefix}: ${errMsg(e)}`;
  }
  return `${prefix}: ${errMsg(e)}`;
}

const NO_CITATION_NOTE = [
  "",
  "注意: 本文に [[source:<id>]] の引用が 1 つも無いため、このページは出典照合の対象になりません。",
  "根拠のある文の文末に [[source:<id>]] を書いて、もう一度 revise_topic で書き直すと、文ごとに出典と照らせます。",
];

const REFLECT_NOTE =
  "Graphium を次に起動すると反映されます。取り消すには undo_operation に runId と operationId を渡してください。";

type CommonInput = { model?: string; sessionId?: string };

// ── revise_topic ────────────────────────────────────────────

export type ReviseTopicInput = CommonInput & { topicId: string; body: string; sources?: string[] };

export async function reviseTopic(input: ReviseTopicInput, ctx: ToolContext, root: string): Promise<string> {
  return withWriteGuard(root, async (lock) => {
    const { topicId, body } = input;
    if (!body.trim()) return "EMPTY_BODY: body が空です。";
    const existing = readWikiDoc(root, topicId);
    if (!existing) return `NOT_FOUND: ページが見つかりません: ${topicId}`;
    const kind = existing.wikiMeta?.kind;
    if (!kind || !KNOWLEDGE_KINDS.includes(kind)) {
      return `NOT_KNOWLEDGE_PAGE: トピック・問答ページ（topic / answer）だけが対象です: ${topicId}（種別: ${kind ?? "なし"}）`;
    }
    if (!isNewFormat(existing)) {
      return (
        `OLD_FORMAT: 「${existing.title}」は古い形式のため書き直せません。` +
        "Graphium の「資料から作り直す」で新しい形式にしてからもう一度お試しください。"
      );
    }
    const flags = getFlags(root, topicId);
    if (flags?.deletedAt || flags?.archivedAt) {
      return `NOT_ACTIVE: 「${existing.title}」はゴミ箱かアーカイブにあります。restore_page で戻してから書き直してください。`;
    }

    // 資料: 渡されたものは全部解決できること。省略時は今の derivedFromNotes（既存の id は解決できなくても許す）
    const currentIds = existing.wikiMeta?.derivedFromNotes ?? [];
    let refs: TopicSourceRef[];
    if (input.sources) {
      const r = resolveSourceRefs(input.sources, root);
      // 素材インデックスから消えたが、ページの今の資料にある id は許す（今の一覧を写して渡す経路）
      const current = new Set(currentIds);
      const bad = r.missing.filter((id) => !current.has(id));
      if (bad.length > 0) return unknownSourceMessage(bad);
      refs = [...r.refs, ...r.missing.map((id) => ({ id, title: id }))];
    } else {
      refs = resolveLenient(currentIds, root);
    }
    // 本文で引いている資料が一覧に無ければ、厳密に解決して足す
    const withBody = addBodySourceRefs(body, refs, root, currentIds);
    if (!withBody.ok) return withBody.message;
    refs = withBody.refs;

    const client = ctx.getClientName?.();
    const host = createMcpMaintenanceHost(root);
    const run = await beginMaintenanceRun(host, {
      trigger: "regenerate",
      actor: buildActor(client, input.model),
    });
    const op = await run.beginOperation({
      kind: "regenerate",
      subject: { wikiId: topicId, title: existing.title },
    });
    if (!op.recording) {
      await run.end().catch(() => undefined);
      return NOT_RECORDED_MESSAGE;
    }
    let note: string | undefined;
    try {
      const stopped = await stoppedIfRunning(root);
      if (stopped) {
        note = "起動を検知して中止";
        return stopped;
      }
      const rebuilt = stampGeneratedBy(
        rebuildSourceBackedWikiDocument(
          existing,
          body,
          refs,
          input.model ?? null,
          buildNoteIndex(readNoteIndex(root)),
        ),
        { client, sessionId: input.sessionId, model: input.model },
      );
      await lock.refresh();
      const ok = await op.save(topicId, rebuilt, {
        activityType: "wiki_regenerate",
        agentLabel: agentLabelFor(client),
        sources: refs.map((r) => r.id),
      });
      if (!ok) {
        note = "保存に失敗";
        return `ページの保存に失敗しました: ${existing.title}`;
      }
      const ended = await op.end();
      return [
        `「${rebuilt.title}」を書き直しました。`,
        `  topicId: ${topicId}`,
        `  本文: ${body.length} 文字 / 資料: ${refs.length} 件`,
        `  runId: ${ended.runId}`,
        `  operationId: ${ended.operationId}`,
        "",
        REFLECT_NOTE,
        ...(body.includes("[[source:") ? [] : NO_CITATION_NOTE),
      ].join("\n");
    } catch (e) {
      note = `失敗: ${errMsg(e)}`;
      return failureMessage("書き直しに失敗しました", e, host);
    } finally {
      if (note !== undefined) await op.end({ note }).catch(() => undefined);
      await run.end().catch(() => undefined);
    }
  });
}

// ── merge_topics ────────────────────────────────────────────

export type MergeTopicsInput = CommonInput & { keepId: string; absorbIds: string[]; body: string };

export async function mergeTopics(input: MergeTopicsInput, ctx: ToolContext, root: string): Promise<string> {
  return withWriteGuard(root, async (lock) => {
    const { keepId, body } = input;
    if (!body.trim()) return "EMPTY_BODY: body が空です。";
    const absorbAll = [...new Set(input.absorbIds)];
    if (absorbAll.includes(keepId)) return "INVALID_ARGUMENT: keepId を absorbIds に含めないでください。";
    if (absorbAll.length === 0) return "INVALID_ARGUMENT: absorbIds が空です。";

    const keep = readWikiDoc(root, keepId);
    if (!keep) return `NOT_FOUND: ページが見つかりません: ${keepId}`;
    const docs = new Map<string, GraphiumDocument>();
    for (const id of [keepId, ...absorbAll]) {
      const doc = id === keepId ? keep : readWikiDoc(root, id);
      if (!doc) return `NOT_FOUND: ページが見つかりません: ${id}`;
      if (doc.wikiMeta?.kind !== "topic") {
        return `NOT_KNOWLEDGE_PAGE: 統合できるのはトピック（topic）だけです: ${id}（種別: ${doc.wikiMeta?.kind ?? "なし"}）`;
      }
      if (!isNewFormat(doc)) {
        return (
          `OLD_FORMAT: 「${doc.title}」は古い形式のため統合できません。` +
          "Graphium の「資料から作り直す」で新しい形式にしてからもう一度お試しください。"
        );
      }
      docs.set(id, doc);
    }
    const keepFlags = getFlags(root, keepId);
    if (keepFlags?.deletedAt || keepFlags?.archivedAt) {
      return `NOT_ACTIVE: 残す側「${keep.title}」はゴミ箱かアーカイブにあります。restore_page で戻してください。`;
    }

    // 吸収側のうち、すでにゴミ箱・アーカイブのものは除く
    const skipped: string[] = [];
    const absorbIds: string[] = [];
    for (const id of absorbAll) {
      const f = getFlags(root, id);
      if (f?.deletedAt || f?.archivedAt) skipped.push(id);
      else absorbIds.push(id);
    }
    if (absorbIds.length === 0) {
      return "NOTHING_TO_MERGE: 吸収する側がすべてゴミ箱かアーカイブにあるため、統合するものがありません。";
    }

    // 資料 id は残す側 → 吸収側の和（既存の id なので解決できなくても許す）
    const idSet: string[] = [];
    for (const id of [keepId, ...absorbIds]) idSet.push(...(docs.get(id)!.wikiMeta?.derivedFromNotes ?? []));
    let refs = resolveLenient(idSet, root);
    const withBody = addBodySourceRefs(body, refs, root, idSet);
    if (!withBody.ok) return withBody.message;
    refs = withBody.refs;

    const client = ctx.getClientName?.();
    const host = createMcpMaintenanceHost(root);
    const run = await beginMaintenanceRun(host, {
      trigger: "merge_topics",
      actor: buildActor(client, input.model),
    });
    const op = await run.beginOperation({
      kind: "merge_topics",
      subject: { wikiId: keepId, title: keep.title },
      related: absorbIds.map((id) => ({ wikiId: id, title: docs.get(id)!.title, role: "absorbed" as const })),
    });
    if (!op.recording) {
      await run.end().catch(() => undefined);
      return NOT_RECORDED_MESSAGE;
    }
    let note: string | undefined;
    try {
      const stopped = await stoppedIfRunning(root);
      if (stopped) {
        note = "起動を検知して中止";
        return stopped;
      }
      const rebuilt = stampGeneratedBy(
        rebuildSourceBackedWikiDocument(keep, body, refs, input.model ?? null, buildNoteIndex(readNoteIndex(root))),
        { client, sessionId: input.sessionId, model: input.model },
      );
      await lock.refresh();
      const ok = await op.save(keepId, rebuilt, {
        activityType: "wiki_cross_update",
        agentLabel: agentLabelFor(client),
        sources: refs.map((r) => r.id),
      });
      if (!ok) {
        note = "残す側の保存に失敗（吸収側は動かしていません）";
        return `残す側の保存に失敗したため、吸収側は動かしていません: ${keep.title}`;
      }

      const trashed: string[] = [];
      for (const id of absorbIds) {
        const s = await stoppedIfRunning(root);
        if (s) {
          note = `起動を検知して中止（ゴミ箱へ移した: ${trashed.length} 件）`;
          return `${s}\n本文は更新済みで、ゴミ箱へ移したのは ${trashed.length}/${absorbIds.length} 件です。取り消すには undo_operation を使ってください。`;
        }
        await op.trash(id);
        await lock.refresh();
        if (!getFlags(root, id)?.deletedAt) {
          note = `「${docs.get(id)!.title}」をゴミ箱へ移せませんでした`;
          return (
            `「${docs.get(id)!.title}」(${id}) をゴミ箱へ移せなかったため、ここで止めました` +
            `（移せた: ${trashed.length}/${absorbIds.length} 件）。`
          );
        }
        trashed.push(id);
      }
      const ended = await op.end();
      return [
        `「${rebuilt.title}」に ${trashed.length} 件のトピックを統合しました。`,
        `  keepId: ${keepId}`,
        `  吸収してゴミ箱へ移した: ${trashed.map((id) => `「${docs.get(id)!.title}」`).join("、")}`,
        ...(skipped.length > 0
          ? [`  すでにゴミ箱・アーカイブのため除いた: ${skipped.map((id) => `「${docs.get(id)!.title}」`).join("、")}`]
          : []),
        `  本文: ${body.length} 文字 / 資料: ${refs.length} 件`,
        `  runId: ${ended.runId}`,
        `  operationId: ${ended.operationId}`,
        "",
        REFLECT_NOTE,
        ...(body.includes("[[source:") ? [] : NO_CITATION_NOTE),
      ].join("\n");
    } catch (e) {
      note = `失敗: ${errMsg(e)}`;
      return failureMessage("統合に失敗しました", e, host);
    } finally {
      if (note !== undefined) await op.end({ note }).catch(() => undefined);
      await run.end().catch(() => undefined);
    }
  });
}

// ── archive_page ────────────────────────────────────────────

export async function archivePage(input: { pageIds: string[] }, ctx: ToolContext, root: string): Promise<string> {
  return withWriteGuard(root, async (lock) => {
    const ids = [...new Set(input.pageIds)];
    if (ids.length === 0) return "INVALID_ARGUMENT: pageIds が空です。";
    const docs = new Map<string, GraphiumDocument>();
    for (const id of ids) {
      const doc = readWikiDoc(root, id);
      if (!doc) return `NOT_FOUND: ページが見つかりません: ${id}`;
      const kind = doc.wikiMeta?.kind;
      if (!kind || !KNOWLEDGE_KINDS.includes(kind)) {
        return `NOT_KNOWLEDGE_PAGE: トピック・問答ページ（topic / answer）だけが対象です: ${id}（種別: ${kind ?? "なし"}）`;
      }
      docs.set(id, doc);
    }
    const skipped: string[] = [];
    const targets: string[] = [];
    for (const id of ids) {
      const f = getFlags(root, id);
      if (f?.deletedAt || f?.archivedAt) skipped.push(id);
      else targets.push(id);
    }
    if (targets.length === 0) return "NOTHING_TO_ARCHIVE: すべてすでにゴミ箱かアーカイブにあります。";

    const client = ctx.getClientName?.();
    const host = createMcpMaintenanceHost(root);
    const run = await beginMaintenanceRun(host, { trigger: "bulk_archive", actor: buildActor(client) });
    const op = await run.beginOperation({
      kind: "archive",
      related: targets.map((id) => ({ wikiId: id, title: docs.get(id)!.title, role: "archived" as const })),
    });
    if (!op.recording) {
      await run.end().catch(() => undefined);
      return NOT_RECORDED_MESSAGE;
    }
    let note: string | undefined;
    try {
      const archived: string[] = [];
      for (const id of targets) {
        const s = await stoppedIfRunning(root);
        if (s) {
          note = `起動を検知して中止（アーカイブ済み: ${archived.length} 件）`;
          return `${s}\nアーカイブしたのは ${archived.length}/${targets.length} 件です。取り消すには undo_operation を使ってください。`;
        }
        await op.archive(id);
        await lock.refresh();
        if (!getFlags(root, id)?.archivedAt) {
          note = `「${docs.get(id)!.title}」をアーカイブできませんでした`;
          return `「${docs.get(id)!.title}」(${id}) をアーカイブできなかったため、ここで止めました（済み: ${archived.length}/${targets.length} 件）。`;
        }
        archived.push(id);
      }
      resetSearchIndex();
      const ended = await op.end();
      return [
        `${archived.length} 件をアーカイブしました: ${archived.map((id) => `「${docs.get(id)!.title}」`).join("、")}`,
        ...(skipped.length > 0
          ? [`すでにゴミ箱・アーカイブのため除いた: ${skipped.map((id) => `「${docs.get(id)!.title}」`).join("、")}`]
          : []),
        `  runId: ${ended.runId}`,
        `  operationId: ${ended.operationId}`,
        "",
        "戻すには restore_page（または undo_operation）を使ってください。",
      ].join("\n");
    } catch (e) {
      note = `失敗: ${errMsg(e)}`;
      return failureMessage("アーカイブに失敗しました", e, host);
    } finally {
      if (note !== undefined) await op.end({ note }).catch(() => undefined);
      await run.end().catch(() => undefined);
    }
  });
}

// ── restore_page ────────────────────────────────────────────

/** アーカイブ・ゴミ箱から戻す。アプリのアーカイブ解除に合わせて操作の記録は残さない */
export async function restorePage(input: { pageId: string }, _ctx: ToolContext, root: string): Promise<string> {
  return withWriteGuard(root, async () => {
    const doc = readWikiDoc(root, input.pageId);
    if (!doc) return `NOT_FOUND: ページが見つかりません: ${input.pageId}`;
    const kind = doc.wikiMeta?.kind;
    if (!kind || !KNOWLEDGE_KINDS.includes(kind)) {
      return `NOT_KNOWLEDGE_PAGE: トピック・問答ページ（topic / answer）だけが対象です: ${input.pageId}（種別: ${kind ?? "なし"}）`;
    }
    const flags = getFlags(root, input.pageId);
    if (!flags?.deletedAt && !flags?.archivedAt) {
      return `NOT_FLAGGED: 「${doc.title}」はゴミ箱にもアーカイブにもありません。`;
    }
    const s = await stoppedIfRunning(root);
    if (s) return s;
    const restored: string[] = [];
    try {
      if (flags.deletedAt) {
        await setFlag(root, input.pageId, "deletedAt", null);
        restored.push("ゴミ箱");
      }
      if (flags.archivedAt) {
        await setFlag(root, input.pageId, "archivedAt", null);
        restored.push("アーカイブ");
      }
    } catch (e) {
      return `戻せませんでした: ${errMsg(e)}`;
    }
    resetSearchIndex();
    return [
      `「${doc.title}」を${restored.join("・")}から戻しました。`,
      "  この操作は操作の記録には残りません。",
      "Graphium を次に起動すると反映されます。",
    ].join("\n");
  });
}

// ── list_operations ─────────────────────────────────────────

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function touchesPage(op: MaintenanceOperation, pageId: string): boolean {
  return (
    op.subject?.wikiId === pageId ||
    op.related.some((r) => r.wikiId === pageId) ||
    op.pages.some((p) => p.wikiId === pageId) ||
    op.flags.some((f) => f.wikiId === pageId)
  );
}

export async function listOperations(
  input: { limit?: number; pageId?: string },
  _ctx: ToolContext,
  root: string,
): Promise<string> {
  if (!vaultExists(root)) return vaultMissingMessage(root);
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const storage = createFsMaintenanceStorage(root);
  // pageId で絞るときは、読む範囲を広げる（絞った後に limit 件を数える）
  const { runs } = await loadRecentRuns(storage, { limit: input.pageId ? 200 : limit });
  const active = activeRunIds();
  const states = deriveOperationStates(runs, active);

  type Row = { runId: string; op: MaintenanceOperation; at: number };
  const rows: Row[] = [];
  for (const run of runs) {
    for (const op of run.operations) {
      if (input.pageId && !touchesPage(op, input.pageId)) continue;
      rows.push({ runId: run.id, op, at: operationOrderTime(op) });
    }
  }
  rows.sort((a, b) => b.at - a.at);
  const shown = rows.slice(0, limit);
  if (shown.length === 0) return "手入れの操作の記録はまだありません。";

  const lines = shown.map(({ runId, op }) => {
    const run = runs.find((r) => r.id === runId)!;
    const info = states.get(`${runId}\u0000${op.id}`);
    const state = info?.state ?? "applied";
    let line =
      `[${runId} / ${op.id}] ${formatTime(op.startedAt)} ${describeActorJa(run.actor)} ` +
      `${describeOperationJa(op)} — ${describeStateJa(state)}`;
    if (state === "applied" || state === "undo_partial" || state === "interrupted") {
      const blockers = findBlockingOperations(runs, { runId, operationId: op.id }, active);
      if (blockers.length > 0) {
        line += `（先に取り消す操作: ${blockers
          .map((b) => `[${b.runId} / ${b.operationId}] ${describeOperationJa(b.op)}`)
          .join(" / ")}）`;
      }
    }
    return line;
  });
  return [`手入れの操作 ${shown.length} 件（新しい順）`, "", ...lines].join("\n");
}

// ── undo_operation ──────────────────────────────────────────

export type UndoOperationInput = CommonInput & { runId: string; operationId: string; confirm?: boolean };

export async function undoOperation(input: UndoOperationInput, ctx: ToolContext, root: string): Promise<string> {
  return withWriteGuard(root, async () => {
    const target = { runId: input.runId, operationId: input.operationId };
    if (parseMaintenanceKey(target.runId)?.kind !== "run") {
      return "NOT_FOUND: runId の形が正しくありません（list_operations の [runId / operationId] を渡してください）。";
    }
    const host = createMcpMaintenanceHost(root);
    try {
      const client = ctx.getClientName?.();
      const storage = createFsMaintenanceStorage(root);
      const { runs } = await loadRunsFrom(storage, target.runId);
      const impact = await describeUndoImpact(host, runs, target);
      if (!impact.canUndo) {
        return impact.refusal ? describeRefusalJa(impact.refusal) : "UNSUPPORTED: 取り消せません";
      }

      // 影響の見積もり
      const warnings: string[] = [];
      for (const p of impact.pages) {
        if (p.deleted) {
          warnings.push(`「${p.title}」は完全に削除されていて戻せません（残りだけ取り消します）。`);
        }
        if (p.editsAfter > 0) {
          warnings.push(`「${p.title}」は操作のあとに ${p.editsAfter} 回編集されています。取り消すとその編集も戻ります。`);
        }
        if (p.untrackedChange) {
          warnings.push(`「${p.title}」は操作のあとに、編集の記録に残らない変更があります。取り消すとその変更も戻ります。`);
        }
        if (p.checksAlsoRevert) {
          warnings.push(`「${p.title}」は出典照合などの結果も戻ります。`);
        }
      }
      for (const f of impact.flags) {
        if (!f.restorable) warnings.push(`「${f.title}」は戻せません（索引にありません）。`);
      }
      if (warnings.length > 0 && input.confirm !== true) {
        return [
          "この操作を取り消すと、次のことが起きます。",
          ...warnings.map((w) => `  - ${w}`),
          "",
          "取り消すには confirm: true で呼び直してください。",
        ].join("\n");
      }

      const s = await stoppedIfRunning(root);
      if (s) return s;

      const outcome = await undoMaintenanceOperation(
        host,
        {
          getAuthor: async () => ({}),
          afterRestore: () => resetSearchIndex(),
          actor: buildActor(client, input.model),
          agentLabel: agentLabelFor(client),
        },
        target,
      );
      if (outcome.status === "refused") return describeRefusalJa(outcome.refusal);
      resetSearchIndex();
      const titleOf = (p: { title: string }) => `「${p.title}」`;
      const hasFailure = outcome.failedPages.length > 0 || outcome.failedFlags.length > 0;
      return [
        hasFailure ? "一部だけ取り消しました。" : "操作を取り消しました。",
        ...(outcome.restoredPages.length > 0
          ? [`  戻したページ: ${outcome.restoredPages.map(titleOf).join("、")}`]
          : []),
        ...(outcome.unchangedPages.length > 0
          ? [`  すでに同じ内容で変わらなかったページ: ${outcome.unchangedPages.map(titleOf).join("、")}`]
          : []),
        ...(outcome.restoredFlags.length > 0
          ? [
              `  戻したフラグ: ${outcome.restoredFlags
                .map((f) => `${f.wikiId}（${f.flag === "deletedAt" ? "ゴミ箱" : "アーカイブ"}）`)
                .join("、")}`,
            ]
          : []),
        ...outcome.failedPages.map((f) => `  失敗（ページ）: 「${f.title}」 ${f.reason}`),
        ...outcome.failedFlags.map((f) => `  失敗（フラグ）: ${f.wikiId} ${f.flag} ${f.reason}`),
        `  取り消しの runId: ${outcome.undoRunId}`,
        `  取り消しの operationId: ${outcome.undoOperationId}`,
        "",
        "この取り消しも操作として記録され、undo_operation で元に戻せます。Graphium を次に起動すると反映されます。",
      ].join("\n");
    } catch (e) {
      return failureMessage("取り消しに失敗しました", e, host);
    }
  });
}

// ── 登録 ────────────────────────────────────────────────────

export function registerUpkeepTools(server: McpServer, ctx: ToolContext = {}): void {
  const root = () => resolveGraphiumRoot();
  const common = {
    model: z.string().optional().describe("書いた LLM のモデル ID（例: claude-opus-5）"),
    sessionId: z.string().optional().describe("呼び出し側のセッション識別子"),
  };

  server.registerTool(
    "revise_topic",
    {
      title: "トピック・問答を書き直す",
      description:
        "ナレッジ層のトピック／問答ページの本文を、Markdown で書き直す。" +
        "Graphium を終了してから使う（起動中は断られる）。すべて記録され、undo_operation で取り消せる。" +
        "根拠のある文の文末に [[source:<id>]] を書く。sources を省略すると今の資料の一覧をそのまま使う。",
      inputSchema: {
        topicId: z.string().describe("書き直すページの id（list_topics の topicId）"),
        body: z.string().describe("新しい本文（Markdown）。文末に [[source:<id>]] を付ける"),
        sources: z.array(z.string()).optional().describe("資料の id の一覧。省略時は今の資料の一覧"),
        ...common,
      },
    },
    async (input) => text(await reviseTopic(input, ctx, root())),
  );

  server.registerTool(
    "merge_topics",
    {
      title: "トピックを統合する",
      description:
        "複数のトピックを 1 つにまとめる。残す側の本文（Markdown）を渡すと、吸収される側はゴミ箱へ移る。" +
        "Graphium を終了してから使う（起動中は断られる）。すべて記録され、undo_operation で取り消せる。",
      inputSchema: {
        keepId: z.string().describe("残す側のトピックの id"),
        absorbIds: z.array(z.string()).describe("吸収されてゴミ箱へ移るトピックの id"),
        body: z.string().describe("統合後の本文（Markdown）。文末に [[source:<id>]] を付ける"),
        ...common,
      },
    },
    async (input) => text(await mergeTopics(input, ctx, root())),
  );

  server.registerTool(
    "archive_page",
    {
      title: "ページをアーカイブする",
      description:
        "トピック／問答ページをアーカイブする（不要になったものをしまう）。" +
        "Graphium を終了してから使う（起動中は断られる）。記録され、undo_operation や restore_page で戻せる。",
      inputSchema: {
        pageIds: z.array(z.string()).min(1).describe("アーカイブするページの id"),
      },
    },
    async (input) => text(await archivePage(input, ctx, root())),
  );

  server.registerTool(
    "restore_page",
    {
      title: "ページをアーカイブ・ゴミ箱から戻す",
      description:
        "アーカイブまたはゴミ箱にあるトピック／問答ページを元に戻す。" +
        "Graphium を終了してから使う（起動中は断られる）。この操作は操作の記録には残らない。",
      inputSchema: {
        pageId: z.string().describe("戻すページの id"),
      },
    },
    async (input) => text(await restorePage(input, ctx, root())),
  );

  server.registerTool(
    "list_operations",
    {
      title: "手入れの操作を一覧する",
      description:
        "手入れの操作（書き直し・統合・アーカイブ・取り消し）の記録を新しい順に返す。Graphium アプリで行ったものも含む。" +
        "各行に runId / operationId と、取り消せるかの状態が付く（undo_operation にそのまま渡せる）。",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().describe("最大件数（既定 20）"),
        pageId: z.string().optional().describe("このページに関わる操作だけに絞る"),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) => text(await listOperations(input, ctx, root())),
  );

  server.registerTool(
    "undo_operation",
    {
      title: "手入れの操作を取り消す",
      description:
        "手入れの操作を 1 回で取り消す（Graphium アプリで行った操作も）。" +
        "Graphium を終了してから使う（起動中は断られる）。操作のあとに編集があるときは、先に影響を返すので、" +
        "確認のうえ confirm: true で呼び直す。取り消しも記録され、もう一度 undo_operation で戻せる。",
      inputSchema: {
        runId: z.string().describe("list_operations の runId"),
        operationId: z.string().describe("list_operations の operationId"),
        confirm: z.boolean().optional().describe("影響を確認したうえで実行するとき true"),
        ...common,
      },
    },
    async (input) => text(await undoOperation(input, ctx, root())),
  );
}
