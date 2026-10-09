// 既存の知見へ判断・規則の構造（frame）を後から補完する、依存注入の純粋なコア。
// 本文ブロックは触らない。版を取ってから wikiMeta だけを書く。
// 仕様: docs/internal/handoff_to_claude_code_judgment_rule_frames.md §5.4 / Step 4

import type { GraphiumDocument, WikiMeta, WikiMetaSummary } from "../../lib/document-types";
import { mergeFrame } from "./merge-frame";
import { applyAsterismDefaults } from "./asterism-link";
import { loadSettings, type AsterismSettings } from "../settings/store";
import { resolveFrameTitles } from "./resolve-frame-titles";
import { saveWikiWithRetry } from "./rationale-write";
import { extractPlainTextFromDoc } from "./wiki-service";
import type { FrameBackfillRequest, FrameBackfillResponse } from "./wiki-service";
import type { IngesterOutput } from "../../server/services/wiki-ingester";

type TitleId = { title: string; id: string };
type SourceItem = { id: string; title: string; content: string };
type FrameFields = Pick<WikiMeta, "statementForm" | "decisionFrame" | "ruleFrame" | "observationFrame">;
type ApiFrame = FrameBackfillResponse["frames"][number];

/** 兄弟（siblingTitles）の上限 */
export const SIBLING_MAX = 50;

/**
 * 一覧に出ている知見（ゴミ箱・アーカイブ済みを除く）だけに wikiMetas を絞る。
 * wikiMetas はゴミ箱送り・アーカイブでは消えないので、呼び出し側が可視 id で絞ってから渡す。
 */
export function filterVisibleMetas(
  wikiMetas: Map<string, WikiMetaSummary>,
  visibleIds: ReadonlySet<string>,
): Map<string, WikiMetaSummary> {
  return new Map([...wikiMetas].filter(([id]) => visibleIds.has(id)));
}

/** 補完の対象: claim かつ（decision 役割 or principle）かつ frame 未保有 */
export function pickBackfillTargets(wikiMetas: Map<string, WikiMetaSummary>): { id: string; title: string }[] {
  const out: { id: string; title: string }[] = [];
  for (const [id, m] of wikiMetas) {
    if (m.kind !== "claim" || m.hasFrames) continue;
    if (m.claimRole?.includes("decision") || m.level === "principle") out.push({ id, title: m.title });
  }
  return out;
}

export type CollectSourcesDeps = {
  /** 出典 id から本文を読む（resolveSourceText の薄いラッパー） */
  resolveSource: (
    id: string,
  ) => Promise<{ ok: true; title?: string; text: string } | { ok: false; reason: string }>;
  /** 知見 id か（derivedFromNotes に混ざる wiki id を除く） */
  isWikiId: (id: string) => boolean;
};

/** 補完 1 回の間だけ生きる出典キャッシュ。失敗も覚えて再取得しない */
export type SourceCache = Map<string, { ok: true; title: string; text: string } | { ok: false; reason: string }>;

/**
 * 知見の出典本文を集める。wiki id は除外、同じ出典は cache で 1 回だけ取得する。
 * 1 つも読めなければ skippedReason を返す（読めなかった最初の理由。出典自体が無ければ "no-sources"）。
 */
export async function collectSourcesFor(
  wikiMeta: { derivedFromNotes?: string[] },
  deps: CollectSourcesDeps,
  cache: SourceCache,
): Promise<{ sources: SourceItem[]; skippedReason?: string }> {
  const ids = [...new Set((wikiMeta.derivedFromNotes ?? []).filter((id) => id && !deps.isWikiId(id)))];
  if (ids.length === 0) return { sources: [], skippedReason: "no-sources" };
  const sources: SourceItem[] = [];
  let firstReason: string | undefined;
  for (const id of ids) {
    let hit = cache.get(id);
    if (!hit) {
      try {
        const r = await deps.resolveSource(id);
        hit = r.ok ? { ok: true, title: r.title ?? id, text: r.text } : { ok: false, reason: r.reason };
      } catch (err) {
        hit = { ok: false, reason: err instanceof Error ? err.message : "unreadable" };
      }
      cache.set(id, hit);
    }
    if (hit.ok) sources.push({ id, title: hit.title, content: hit.text });
    else firstReason ??= hit.reason;
  }
  if (sources.length === 0) return { sources, skippedReason: firstReason ?? "unreadable" };
  return { sources };
}

/** 同じ出典を derivedFromNotes に持つ他の claim（自分を除く、最大 max 件） */
export function siblingTitlesFor(
  id: string,
  wikiMeta: { derivedFromNotes?: string[] },
  wikiMetas: Map<string, WikiMetaSummary>,
  max: number = SIBLING_MAX,
): TitleId[] {
  const mine = new Set(wikiMeta.derivedFromNotes ?? []);
  const out: TitleId[] = [];
  if (mine.size === 0) return out;
  for (const [otherId, m] of wikiMetas) {
    if (out.length >= max) break;
    if (otherId === id || m.kind !== "claim") continue;
    if ((m.derivedFromNotes ?? []).some((s) => mine.has(s))) out.push({ title: m.title, id: otherId });
  }
  return out;
}

/**
 * API 応答 1 件を WikiMeta の frame 欄に変換する。
 * - decisionFrame: trigger が解決できれば inferred（inferredFields: ["trigger"]）、無ければ extracted。
 *   rationale は逐語照合済みなので rationaleBy: "extracted"
 * - ruleFrame / observationFrame: extracted
 */
export function toWikiMetaFrames(frame: ApiFrame, siblingTitles: TitleId[], selfId: string): FrameFields {
  const out: FrameFields = {};
  if (frame.statementForm) out.statementForm = frame.statementForm;
  const d = frame.decisionFrame;
  if (d) {
    const resolved = resolveFrameTitles({ decisionFrame: d } as unknown as IngesterOutput, [], siblingTitles, selfId);
    const hasTrigger = resolved.triggerClaimIds.length > 0;
    out.decisionFrame = {
      triggerClaimIds: resolved.triggerClaimIds,
      action: d.action,
      rationale: d.rationale,
      rationaleBy: "extracted",
      rationaleRuleIds: resolved.rationaleRuleIds,
      reviewState: hasTrigger ? "inferred" : "extracted",
      ...(hasTrigger ? { inferredFields: ["trigger" as const] } : {}),
    };
  }
  if (frame.ruleFrame) {
    out.ruleFrame = {
      conditions: frame.ruleFrame.conditions,
      consequences: frame.ruleFrame.consequences,
      mechanism: frame.ruleFrame.mechanism,
      reviewState: "extracted",
    };
  }
  if (frame.observationFrame) {
    out.observationFrame = {
      featureOfInterest: frame.observationFrame.featureOfInterest,
      results: frame.observationFrame.results,
      reviewState: "extracted",
    };
  }
  return out;
}

/** frame を足した新しい doc を返す。mergeFrame を通し、本文（pages）は一切触らない */
export function applyBackfillToDoc(
  doc: GraphiumDocument,
  frames: FrameFields,
  /** Asterism 連携の設定。省略時は保存済みの設定を使う */
  asterismSettings: AsterismSettings = loadSettings().asterism,
): GraphiumDocument {
  if (!doc.wikiMeta) throw new Error("wikiMeta not found");
  const merged = mergeFrame(doc.wikiMeta, { ...doc.wikiMeta, ...frames });
  return { ...doc, wikiMeta: applyAsterismDefaults(merged, asterismSettings) };
}

export type BackfillProgress = { done: number; total: number; currentTitle?: string };

export type BackfillDeps = CollectSourcesDeps & {
  /** 知見 doc を読む（wiki id） */
  loadDoc: (wikiId: string) => Promise<GraphiumDocument | null>;
  wikiMetas: Map<string, WikiMetaSummary>;
  callApi: (req: FrameBackfillRequest) => Promise<FrameBackfillResponse>;
  takeSnapshot: (wikiId: string, doc: GraphiumDocument, label: string) => Promise<unknown>;
  /** 保存中などで受け付けられなければ false */
  saveWiki: (wikiId: string, doc: GraphiumDocument) => Promise<boolean>;
  /** 版のラベル（tStatic("version.frameBackfillLabel")） */
  label: string;
  language?: string;
  /** 中止シグナル。aborted になったら残りの知見を処理せず、そこまでの結果を返す */
  signal?: AbortSignal;
  /**
   * 今エディタで開いている知見か。エディタは開いた時点の wikiMeta から doc を組んで自動保存するため、
   * 開いたままの知見に書くと補完した frame が次の編集保存で消える。該当する知見はスキップする
   */
  isOpenInEditor?: (wikiId: string) => boolean;
};

export type FrameBackfillSummary = {
  done: { id: string; title: string }[];
  skipped: { id: string; title: string; reason: string }[];
  failed: { id: string; title: string; error: string }[];
  droppedFrames: number;
  truncatedSources: string[];
  /** 中止された（残りの知見は未処理） */
  aborted?: boolean;
};

/** 1 件ずつ直列に補完する。API 失敗・保存失敗は記録して続行する */
export async function runFrameBackfill(
  targets: { id: string; title: string }[],
  deps: BackfillDeps,
  onProgress?: (p: BackfillProgress) => void,
): Promise<FrameBackfillSummary> {
  const summary: FrameBackfillSummary = { done: [], skipped: [], failed: [], droppedFrames: 0, truncatedSources: [] };
  const cache: SourceCache = new Map();
  const truncated = new Set<string>();
  let n = 0;
  for (const target of targets) {
    if (deps.signal?.aborted) {
      summary.aborted = true;
      break;
    }
    onProgress?.({ done: n, total: targets.length, currentTitle: target.title });
    try {
      if (deps.isOpenInEditor?.(target.id)) {
        summary.skipped.push({ ...target, reason: "open-in-editor" });
        continue;
      }
      const doc = await deps.loadDoc(target.id);
      if (!doc?.wikiMeta) {
        summary.skipped.push({ ...target, reason: "not-loaded" });
        continue;
      }
      const { sources, skippedReason } = await collectSourcesFor(doc.wikiMeta, deps, cache);
      if (skippedReason) {
        summary.skipped.push({ ...target, reason: skippedReason });
        continue;
      }
      const siblings = siblingTitlesFor(target.id, doc.wikiMeta, deps.wikiMetas);
      const res = await deps.callApi({
        sources,
        claims: [
          {
            id: target.id,
            title: doc.title || target.title,
            body: extractPlainTextFromDoc(doc),
            claimRole: doc.wikiMeta.claimRole,
            level: doc.wikiMeta.level,
            epistemicStatus: doc.wikiMeta.epistemicStatus,
            siblingTitles: siblings,
          },
        ],
        ...(deps.language ? { language: deps.language } : {}),
      });
      summary.droppedFrames += res.droppedFrames ?? 0;
      for (const s of res.truncatedSources ?? []) truncated.add(s);
      const frame = res.frames?.find((f) => f.id === target.id);
      const fields = frame ? toWikiMetaFrames(frame, siblings, target.id) : {};
      if (!fields.decisionFrame && !fields.ruleFrame && !fields.observationFrame) {
        summary.skipped.push({ ...target, reason: "no-frame" });
        continue;
      }
      // API 待ちの間に利用者が編集した可能性があるため、保存直前に読み直す。
      // 版も保存も最新の doc を土台にし、wikiMeta の frame だけを差し替える（本文を巻き戻さない）
      const fresh = (await deps.loadDoc(target.id)) ?? doc;
      if (!fresh.wikiMeta) {
        summary.skipped.push({ ...target, reason: "not-loaded" });
        continue;
      }
      // API 待ちの間に開かれた場合も書かない（エディタの自動保存で上書きされるため）
      if (deps.isOpenInEditor?.(target.id)) {
        summary.skipped.push({ ...target, reason: "open-in-editor" });
        continue;
      }
      // 版を先に取る（force）。取れなければ保存しない
      await deps.takeSnapshot(target.id, fresh, deps.label);
      const next = applyBackfillToDoc(fresh, fields);
      await saveWikiWithRetry(deps.saveWiki, target.id, next);
      summary.done.push({ ...target });
    } catch (err) {
      // 中止による例外は失敗として数えない
      if (deps.signal?.aborted) {
        summary.aborted = true;
        break;
      }
      summary.failed.push({ ...target, error: err instanceof Error ? err.message : String(err) });
    } finally {
      n++;
    }
  }
  summary.truncatedSources = [...truncated];
  onProgress?.({ done: n, total: targets.length });
  return summary;
}
