// 出典照合（Source check, v1.1）— 画面から実行・保存するための単一のフック。
//
// WikiBanner（1 ドキュメントだけ実行）と WikiLintView（複数ドキュメントをまとめて計画・実行）の
// 両方がこのフックを使う（仕様 2-d: 「実行と保存を 1 つのフックにまとめる」）。
// ビジネスロジック（resolveSourceText の依存の組み立て・plan/run/save）はここに集約し、
// 各画面コンポーネントは UI 状態だけを持つ。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphiumDocument, SourceCheckProfile, WikiMetaSummary } from "../lib/document-types";
import type { GraphiumIndex } from "../features/navigation/index-file";
import type { MediaIndex } from "../features/asset-browser/media-index";
import type { CaptureIndex } from "../features/mobile-capture/capture-store";
import {
  attachSourceCheck,
  buildSourceCheckStatements,
  computeClaimHash,
  planSourceCheck,
  runSourceCheck,
  saveSourceCheckResults,
  type PlanSourceCheckStatement,
  type ResolveSourceTextDeps,
  type SourceCheckLogger,
  type SourceCheckPlan,
  type SourceCheckTarget,
} from "../features/source-check";
import type { SourceCheckEntry } from "../lib/document-types";
import { parseClaimSourceId } from "../features/source-check/claim-source-id";
import { parseExternalSource } from "../features/network-graph/external-source";
import { extractPlainTextFromDoc } from "../features/wiki/wiki-service";
import { loadUrlText } from "../features/ai-assistant/url-text-loader";
import { getLocale } from "../i18n";
import { getActiveProvider } from "../lib/storage/registry";

export type SourceCheckTargetKind = "claim" | "topic" | "both";
export type SourceCheckScope = "unchecked" | "stale" | "all";

/** runningRef の値として使う、一括実行中を示す番兵（実 docId とは絶対に衝突しない値）。 */
const BATCH_RUN_MARKER = "__source_check_batch__";

export type BatchRunResult = { profiles: Map<string, SourceCheckProfile>; interrupted: boolean };

export type UseSourceCheckDeps = {
  noteIndex: GraphiumIndex | null;
  /** ゴミ箱を含む全件（deletedAt 判定に使う。noteIndex は除外済みビューのため使えない） */
  rawNoteIndex: GraphiumIndex | null;
  mediaIndex: MediaIndex | null;
  captureIndex: CaptureIndex | null;
  wikiFiles: { id: string }[];
  wikiMetas: Map<string, WikiMetaSummary>;
  getCachedDoc: (id: string) => GraphiumDocument | null | undefined;
  loadDoc: (id: string) => Promise<GraphiumDocument | null>;
  saveWikiFile: (wikiId: string, doc: GraphiumDocument) => Promise<unknown>;
  activeFileId?: string | null;
  reopenActiveWikiFile?: (wikiId: string) => void;
  /** テスト用差し替え。未指定なら runSourceCheck の既定（wikiLog.append, IndexedDB）を使う */
  logger?: SourceCheckLogger;
};

/** ファイル ID（"wiki:<id>" 形式含む）からキャッシュ優先でドキュメントを読む */
async function loadDocByFullKey(
  fullId: string,
  deps: Pick<UseSourceCheckDeps, "getCachedDoc" | "loadDoc">,
): Promise<GraphiumDocument | null> {
  const cached = deps.getCachedDoc(fullId);
  if (cached) return cached;
  return deps.loadDoc(fullId);
}

/** Wiki（knowledge）ドキュメントを wikiId から読む */
function loadWikiDoc(
  docId: string,
  deps: Pick<UseSourceCheckDeps, "getCachedDoc" | "loadDoc">,
): Promise<GraphiumDocument | null> {
  return loadDocByFullKey(`wiki:${docId}`, deps);
}

/** resolveSourceText の依存を、note-app 側が持つ index / provider から組み立てる */
function buildResolveDeps(deps: UseSourceCheckDeps): ResolveSourceTextDeps {
  return {
    findNote: (noteId) => {
      const entry = deps.rawNoteIndex?.notes.find((n) => n.noteId === noteId);
      return entry ? { deletedAt: entry.deletedAt } : undefined;
    },
    isWikiId: (id) => deps.wikiMetas.has(id),
    // 通常ノートは "wiki:" プレフィックス無しの ID で読む
    loadNoteDoc: (noteId) => loadDocByFullKey(noteId, deps),
    loadMediaBytes: async (fileId) => {
      // getActiveProvider は遅延評価する（pdf:/document: 出典があるときだけ呼ぶ）。
      // テスト環境や provider 未登録のまま note-app がマウントされた直後でも、
      // 出典が通常ノートだけの照合はこの関数を通らないため落ちない。
      try {
        const provider = getActiveProvider();
        const blobUrl = await provider.getMediaBlobUrl(fileId);
        const blob = await (await fetch(blobUrl)).blob();
        return new Uint8Array(await blob.arrayBuffer());
      } catch {
        return undefined;
      }
    },
    findMediaName: (fileId) => deps.mediaIndex?.media.find((m) => m.fileId === fileId)?.name,
    // loadStoredUrlText: URL から「その URL を原文として保存しているノート」を引く既存の
    // 索引が無い（sourceTextFileId はノート個別のフィールドで、mediaIndex には mirror されて
    // いない）。実装せず undefined のままにして再取得（fetchUrlText）にフォールバックする
    // （仕様 2-d の明示的な許可: 「見つけ方が既存に無ければ実装せず undefined のまま」）。
    fetchUrlText: async (url) => {
      const text = await loadUrlText(url);
      if (!text) return null;
      return { text };
    },
    findCaptureText: (captureId) => deps.captureIndex?.captures.find((c) => c.id === captureId)?.text,
    findClaim: (claimId) => {
      if (!deps.wikiMetas.has(claimId)) return undefined;
      const entry = deps.rawNoteIndex?.notes.find((n) => n.noteId === claimId);
      return { deletedAt: entry?.deletedAt, archivedAt: entry?.archivedAt };
    },
    loadClaimDoc: (claimId) => loadWikiDoc(claimId, deps),
  };
}

export type LintPlanResult = {
  plan: SourceCheckPlan;
  statementsById: Map<string, PlanSourceCheckStatement>;
  /** 対象ドキュメントの数（plan.docCount と同じだが、対象が 0 件のときの分岐に使う） */
  targetCount: number;
};

export function useSourceCheck(deps: UseSourceCheckDeps) {
  // WikiBanner の単発実行（docId ごとに loading フラグ）
  const [runningDocId, setRunningDocId] = useState<string | null>(null);
  // WikiLintView のバッチ実行
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ index: number; total: number } | null>(null);
  // 直近の一括実行の結果。点検欄（SourceCheckLintSection）はこの state を props 経由で
  // 受け取って表示する（ローカル state に置くと画面を離れて戻ったときに消える）。
  const [batchResult, setBatchResult] = useState<BatchRunResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // 二重実行防止は state ではなく ref で同期的に判定する。同じレンダーサイクル内で
  // runOne が連続で呼ばれても（state 更新は非同期にしか反映されない）、ref なら
  // 呼び出しの都度すぐ読み書きできるので取りこぼさない。
  // runOne（1 件）と runLintPlan（一括）は同じ ref を共有する — 一括実行中に
  // 個別の「もう一度照合」を押しても、逆に個別実行中に一括を確認・実行しても、
  // 同じ出典照合の対象ドキュメントを取り合って壊すことがないようにする（仕様: 相互排他）。
  const runningRef = useRef<string | null>(null);

  const resolveDeps = useMemo(() => buildResolveDeps(deps), [deps]);

  const saveDeps = useMemo(
    () => ({
      getCachedDoc: (id: string) => deps.getCachedDoc(id) ?? undefined,
      loadDoc: deps.loadDoc,
      saveWikiFile: deps.saveWikiFile,
      activeFileId: deps.activeFileId,
      reopenActiveWikiFile: deps.reopenActiveWikiFile,
    }),
    [deps],
  );

  /** 1 ドキュメントだけ実行する（WikiBanner の実行 / 再照合ボタン） */
  const runOne = useCallback(
    async (docId: string): Promise<void> => {
      if (runningRef.current) return;
      runningRef.current = docId;
      setRunningDocId(docId);
      try {
        const doc = await loadWikiDoc(docId, deps);
        if (!doc?.wikiMeta) return;
        const statements = buildSourceCheckStatements([{ docId, doc }]);
        if (statements.length === 0) return;
        const plan = planSourceCheck(statements);
        const statementsById = new Map(statements.map((s) => [s.id, s]));
        const result = await runSourceCheck(plan, {
          statementsById,
          deps: resolveDeps,
          language: getLocale(),
          logger: deps.logger,
        });
        await saveSourceCheckResults(result.profiles, saveDeps);
      } finally {
        runningRef.current = null;
        setRunningDocId((cur) => (cur === docId ? null : cur));
      }
    },
    [deps, resolveDeps, saveDeps],
  );

  /** 確認済み（dismissed）を反転する。onDismiss と同じ保存経路（activityType 無し） */
  const dismiss = useCallback(
    async (docId: string): Promise<void> => {
      const doc = await loadWikiDoc(docId, deps);
      const profile = doc?.wikiMeta?.sourceCheck;
      if (!doc || !profile) return;
      const next: GraphiumDocument = {
        ...attachSourceCheck(doc, { ...profile, dismissed: !profile.dismissed }),
        modifiedAt: new Date().toISOString(),
      };
      await deps.saveWikiFile(docId, next);
      if (deps.activeFileId === `wiki:${docId}`) deps.reopenActiveWikiFile?.(docId);
    },
    [deps],
  );

  /** 判定結果を消す（attachSourceCheck(doc, undefined)） */
  const clear = useCallback(
    async (docId: string): Promise<void> => {
      const doc = await loadWikiDoc(docId, deps);
      if (!doc?.wikiMeta?.sourceCheck) return;
      const next: GraphiumDocument = {
        ...attachSourceCheck(doc, undefined),
        modifiedAt: new Date().toISOString(),
      };
      await deps.saveWikiFile(docId, next);
      if (deps.activeFileId === `wiki:${docId}`) deps.reopenActiveWikiFile?.(docId);
    },
    [deps],
  );

  /**
   * 対象（claim/topic/both）と範囲（unchecked/stale/all）から、実行前の確認ダイアログ用の
   * 計画を組み立てる（WikiLintView 用）。対象ドキュメントを実際に読み込む（推定係数を
   * 使わない実測値にするため）。
   */
  const planForLint = useCallback(
    async (target: SourceCheckTargetKind, scope: SourceCheckScope): Promise<LintPlanResult> => {
      const wantedKinds = target === "both" ? ["claim", "topic"] : [target];
      const candidates = deps.wikiFiles.filter((f) => {
        const meta = deps.wikiMetas.get(f.id);
        return meta && wantedKinds.includes(meta.kind);
      });

      const targets: SourceCheckTarget[] = [];
      for (const f of candidates) {
        const doc = await loadWikiDoc(f.id, deps);
        if (!doc?.wikiMeta) continue;
        if (scope === "unchecked" && doc.wikiMeta.sourceCheck) continue;
        if (scope === "stale") {
          const existing = doc.wikiMeta.sourceCheck;
          if (!existing) continue;
          const hash = await computeClaimHash(doc.title ?? "", extractPlainTextFromDoc(doc));
          if (hash === existing.claimHash) continue;
        }
        targets.push({ docId: f.id, doc });
      }

      const statements = buildSourceCheckStatements(targets);
      const plan = planSourceCheck(statements);
      const statementsById = new Map(statements.map((s) => [s.id, s]));
      return { plan, statementsById, targetCount: targets.length };
    },
    [deps],
  );

  /**
   * planForLint の結果を実行し、保存する。進捗・中断（cancel）に対応する。
   * runOne と同じ runningRef を共有する（仕様: 相互排他）。既に何か（1 件 or 一括）が
   * 実行中なら何もせず、空の結果を返す（呼び出し側は batchResult / batchRunning を
   * props 経由で見るため、この戻り値自体を UI に使う必要はない）。
   */
  const runLintPlan = useCallback(
    async (
      planResult: LintPlanResult,
      onProgress?: (info: { index: number; total: number }) => void,
    ): Promise<BatchRunResult> => {
      if (runningRef.current) return { profiles: new Map(), interrupted: false };
      runningRef.current = BATCH_RUN_MARKER;
      const controller = new AbortController();
      abortRef.current = controller;
      setBatchRunning(true);
      setBatchProgress({ index: 0, total: planResult.plan.groups.length });
      setBatchResult(null);
      try {
        const result = await runSourceCheck(planResult.plan, {
          statementsById: planResult.statementsById,
          deps: resolveDeps,
          language: getLocale(),
          signal: controller.signal,
          logger: deps.logger,
          onProgress: (info) => {
            setBatchProgress({ index: info.index, total: info.total });
            onProgress?.({ index: info.index, total: info.total });
          },
        });
        await saveSourceCheckResults(result.profiles, saveDeps);
        setBatchResult(result);
        return result;
      } finally {
        runningRef.current = null;
        setBatchRunning(false);
        setBatchProgress(null);
        abortRef.current = null;
      }
    },
    [resolveDeps, saveDeps],
  );

  /** 点検欄の完了表示を閉じる（次の計画へ戻る）。 */
  const resetBatchResult = useCallback(() => setBatchResult(null), []);

  const cancelLintRun = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    runningDocId,
    batchRunning,
    batchProgress,
    batchResult,
    resetBatchResult,
    runOne,
    dismiss,
    clear,
    planForLint,
    runLintPlan,
    cancelLintRun,
  };
}

/**
 * WikiBanner の実行ボタンの title に出す「判定 N 回」。
 * 出典照合の対象（claim/topic）以外は undefined。純関数で同期的に計算する
 * （既に読み込み済みの doc から作るだけなので非同期の解決は不要）。
 */
export function sourceCheckLlmCallsFor(docId: string, doc: GraphiumDocument | null | undefined): number | undefined {
  if (!doc?.wikiMeta) return undefined;
  if (doc.wikiMeta.kind !== "claim" && doc.wikiMeta.kind !== "topic") return undefined;
  const statements = buildSourceCheckStatements([{ docId, doc }]);
  if (statements.length === 0) return undefined;
  return planSourceCheck(statements).llmCalls;
}

/**
 * 照合後に本文が変わったか（stale 判定）。claimHash 計算に使う本文テキストは、
 * 実行時に claimHash を計算したのと同じ関数（extractPlainTextFromDoc）を使う
 * （別の抽出関数を使うと常に stale になる、という既知の罠を踏まないため）。
 */
export function useSourceCheckStale(doc: GraphiumDocument | null | undefined): boolean {
  const [stale, setStale] = useState(false);
  const profile = doc?.wikiMeta?.sourceCheck;
  const title = doc?.title ?? "";
  const body = doc ? extractPlainTextFromDoc(doc) : "";

  useEffect(() => {
    let cancelled = false;
    if (!profile) {
      setStale(false);
      return;
    }
    computeClaimHash(title, body).then((hash) => {
      if (!cancelled) setStale(hash !== profile.claimHash);
    });
    return () => {
      cancelled = true;
    };
  }, [profile, title, body]);

  return stale;
}

/**
 * SourceCheckEntry[] の sourceId → 表示名を noteIndex / mediaIndex / wikiMetas から解決する
 * （仕様 2-a: 「sourceTitles: noteIndex / mediaIndex / wikiMetas から現在のタイトルを引く」）。
 * WikiBanner.tsx の resolveExternalLabel と同じ区別（claim: / pdf: / document: / url: /
 * memo: / chat: / 通常ノート）を踏襲する。解決できなければキー自体を省略し、
 * SourceCheckDetailSection 側で sourceId をそのまま表示させる。
 */
export function resolveSourceCheckTitles(
  entries: SourceCheckEntry[],
  deps: {
    noteIndex: GraphiumIndex | null;
    mediaIndex: MediaIndex | null;
    wikiMetas: Map<string, WikiMetaSummary>;
  },
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of entries) {
    const id = entry.sourceId;
    if (out[id]) continue;

    const claimId = parseClaimSourceId(id);
    if (claimId !== null) {
      const title = deps.wikiMetas.get(claimId)?.title;
      if (title) out[id] = title;
      continue;
    }

    const ext = parseExternalSource(id);
    if (ext) {
      if (ext.kind === "chat") {
        out[id] = "AI Chat";
      } else if (ext.kind === "memo") {
        out[id] = "Memo";
      } else if (ext.kind === "url") {
        const media = deps.mediaIndex?.media.find((m) => m.type === "url" && m.url === ext.key);
        if (media?.name) out[id] = media.name;
      } else {
        const media = deps.mediaIndex?.media.find((m) => m.fileId === ext.key);
        if (media?.name) out[id] = media.name;
      }
      continue;
    }

    const noteEntry = deps.noteIndex?.notes.find((n) => n.noteId === id);
    if (noteEntry?.title) out[id] = noteEntry.title;
  }
  return out;
}
