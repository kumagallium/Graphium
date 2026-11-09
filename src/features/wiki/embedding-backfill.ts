// 埋め込みの後追い（起動時）
// MCP 経由（アプリ非起動）で作られたナレッジのページは IndexedDB に埋め込みが無い。
// 起動後にバックグラウンドで 1 件ずつ作る。設計: docs/internal/mcp-knowledge-generation-design-2026-10.md §8 Q3
// ・対象: 埋め込みレコードが 1 件も無いページ（text-only だけのものは対象外。理由は下記）。
//   ただし埋め込みがこのパソコンのモデルに決まっているときは、text-only だけのページも対象にする
//   （API が無くて text-only に落ちたページが、モデルを取得したあとにベクトルを得る経路）
// ・1 回の起動で、作れた件数が BACKFILL_LIMIT 件、読み込みが BACKFILL_LOAD_LIMIT 件まで。順番に（同時 1 本）
// ・失敗したら何も書かない（text-only で固定しない）。失敗したページは飛ばして次へ進み、
//   BACKFILL_MAX_CONSECUTIVE_FAILURES 件続けて失敗したら（サイドカー未起動・認証切れ・429 など、
//   どのページでも落ちる失敗）残りを次回の起動に回す
// ・失敗したページとセクション 0 件のページは「後回し」として覚え、次の起動では一覧の最後に回す。
//   以前は 1 件目の失敗で起動ごと止まり、次の起動も同じページが先頭に来るので、
//   毎回失敗するページが 1 つあると後追いが永久に進まなかった
// ・埋め込みモデルが未設定のときは何もしない。デスクトップはサイドカーの準備完了を待つ

import { useEffect, useRef } from "react";
import type { GraphiumDocument } from "../../lib/document-types";
import { embeddingStore } from "../../lib/embedding-store";
import { isTauri } from "../../lib/platform";
import { getSidecarState, subscribeSidecarState } from "../../lib/sidecar";
import { getEmbeddingModel, getSelectedModel } from "../settings/store";
import { currentEmbeddingEngine } from "../embedding/client";
import * as localEmbedding from "../embedding/api";

/** 1 回の起動で後追いする最大件数（残りは次回の起動） */
export const BACKFILL_LIMIT = 50;
/** 1 回の起動で読み込む最大件数（セクション 0 件のページなどで起動を重くしない） */
export const BACKFILL_LOAD_LIMIT = 200;
/** 起動直後の読み込みと競合しないよう、後追いを始めるまでの待ち（ms） */
export const BACKFILL_DELAY_MS = 5_000;
/** デスクトップでサイドカーの準備完了を待つ上限（ms）。超えたら次回の起動に回す */
export const SIDECAR_WAIT_MS = 60_000;
/** 続けてこの件数失敗したら、残りを次回の起動に回す（全部が落ちる失敗で要求を投げ続けない） */
export const BACKFILL_MAX_CONSECUTIVE_FAILURES = 2;
/** 後回しにするページ ID を覚えておく localStorage のキー */
export const BACKFILL_DEFERRED_KEY = "graphium-embedding-backfill-deferred";
/** 後回しの記録の上限件数（古いものから捨てる。捨てられても一覧の順に戻るだけ） */
export const BACKFILL_DEFERRED_MAX = 5_000;

/**
 * 後追いの対象を選ぶ純関数。埋め込みレコードを 1 件も持たない ID を、一覧の順で limit 件まで返す。
 * text-only だけのページは「レコードあり」として除く: embed API が使えない環境だと
 * 毎回 text-only に落ちて起動のたびに再試行してしまうため。
 * 直す手段は設定 → ナレッジ管理の「埋め込みの作り直し」（人が起動する）に残す。
 * deferred（前回までに失敗した・セクションが無かったページ）は除かず、ほかのページの後ろに回す。
 */
export function selectBackfillTargets(
  wikiIds: readonly string[],
  embeddedDocumentIds: ReadonlySet<string>,
  limit: number = BACKFILL_LOAD_LIMIT,
  deferredIds: ReadonlySet<string> = new Set(),
): string[] {
  const out: string[] = [];
  const later: string[] = [];
  for (const id of wikiIds) {
    if (out.length >= limit) break;
    if (embeddedDocumentIds.has(id)) continue;
    if (deferredIds.has(id)) later.push(id);
    else out.push(id);
  }
  for (const id of later) {
    if (out.length >= limit) break;
    out.push(id);
  }
  return out;
}

/** 後回しの記録を読む（読めなければ空。記録が無くても一覧の順で動くだけ） */
export function loadDeferredIds(): Set<string> {
  try {
    const raw = localStorage.getItem(BACKFILL_DEFERRED_KEY);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

/** 後回しの記録を書く（挿入順を保ち、上限を超えたら古いものから捨てる） */
export function saveDeferredIds(ids: ReadonlySet<string>): void {
  try {
    const list = [...ids];
    localStorage.setItem(BACKFILL_DEFERRED_KEY, JSON.stringify(list.slice(Math.max(0, list.length - BACKFILL_DEFERRED_MAX))));
  } catch {
    // 書けなくても後追い自体は動く（後回しが効かないだけ）
  }
}

export type BackfillDeps = {
  wikiIds: readonly string[];
  loadDoc: (id: string) => Promise<GraphiumDocument | null | undefined>;
  /** strict で埋め込む。失敗は例外、戻り値はセクション数（0 = 何も書いていない） */
  embed: (id: string, doc: GraphiumDocument) => Promise<number | void>;
  listEmbeddedIds?: () => Promise<Set<string>>;
  /** 埋め込みモデルが設定されているか（既存の作り直しと同じく、専用 || 既定モデル） */
  hasEmbeddingModel?: () => boolean;
  /** 実行前に呼ぶ。false なら何もせず次回に回す（サイドカー待ち） */
  waitReady?: () => Promise<boolean>;
  /** 作れた件数の上限 */
  limit?: number;
  /** 読み込む件数の上限 */
  loadLimit?: number;
  isCancelled?: () => boolean;
  /** 後回しの記録の読み書き（既定は localStorage） */
  loadDeferred?: () => Set<string>;
  saveDeferred?: (ids: ReadonlySet<string>) => void;
};

/** 後追いを実行し、作った件数を返す。続けて失敗したら残りは中止する */
export async function runEmbeddingBackfill(deps: BackfillDeps): Promise<number> {
  const local = currentEmbeddingEngine().kind === "local";
  const hasModel = deps.hasEmbeddingModel ?? (() => local || !!(getEmbeddingModel() || getSelectedModel()));
  if (!hasModel()) return 0;
  // 端末内なら text-only だけのページも「無い」扱い（失敗しても毎回 text-only に落ちはしない。
  // モデル未取得なら embed が失敗して 1 件目で止まり、次回に回る）
  const embedded = await (deps.listEmbeddedIds ?? (() => (local ? embeddingStore.listDocumentIdsWithVectors() : embeddingStore.listDocumentIds())))();
  const deferred = (deps.loadDeferred ?? loadDeferredIds)();
  const targets = selectBackfillTargets(deps.wikiIds, embedded, deps.loadLimit ?? BACKFILL_LOAD_LIMIT, deferred);
  if (targets.length === 0) return 0;
  if (deps.waitReady && !(await deps.waitReady())) {
    console.info("[embedding-backfill] 準備ができていないため次回に回します");
    return 0;
  }
  const limit = deps.limit ?? BACKFILL_LIMIT;
  const saveDeferred = deps.saveDeferred ?? saveDeferredIds;
  let changed = false;
  // 後回しにする（記録の末尾へ）。挿入順で古いものから捨てるので、入れ直して新しくする
  const defer = (id: string) => {
    deferred.delete(id);
    deferred.add(id);
    changed = true;
  };
  let done = 0;
  let failures = 0;
  for (const id of targets) {
    if (done >= limit || deps.isCancelled?.()) break;
    try {
      const doc = await deps.loadDoc(id);
      if (!doc) continue;
      const count = await deps.embed(id, doc);
      failures = 0;
      if (count === 0) {
        // セクションが無いページは何も書かれない。件数に数えず、次の起動では後ろに回す
        defer(id);
      } else {
        done++;
        if (deferred.delete(id)) changed = true;
      }
    } catch (err) {
      // このページは次の起動で後ろに回す。続けて落ちるなら（サイドカー未起動など）残りは次回へ
      defer(id);
      failures++;
      if (failures >= BACKFILL_MAX_CONSECUTIVE_FAILURES) {
        console.warn(`[embedding-backfill] failed for ${id}; stop and retry next launch`, err);
        break;
      }
      console.warn(`[embedding-backfill] failed for ${id}; skip it and retry at the end of the next launch`, err);
    }
  }
  if (changed) saveDeferred(deferred);
  console.info(`[embedding-backfill] ${done} 件の埋め込みを作りました`);
  return done;
}

/** デスクトップはサイドカーが ready になるまで待つ（それ以外は即 true） */
export function waitForSidecarReady(timeoutMs: number = SIDECAR_WAIT_MS): Promise<boolean> {
  if (!isTauri() || getSidecarState().status === "ready") return Promise.resolve(true);
  return new Promise((resolve) => {
    let unsubscribe: () => void = () => {};
    const timer = setTimeout(() => { unsubscribe(); resolve(false); }, timeoutMs);
    unsubscribe = subscribeSidecarState(() => {
      if (getSidecarState().status === "ready") {
        clearTimeout(timer);
        unsubscribe();
        resolve(true);
      }
    });
  });
}

/**
 * 起動時の後追いフック。ナレッジ一覧が読み込まれたら、BACKFILL_DELAY_MS 後に 1 回だけ走る。
 * wikiIds はアーカイブ・ゴミ箱を除いた一覧を渡すこと。
 */
export function useEmbeddingBackfill(args: {
  enabled: boolean;
  wikiIds: readonly string[];
  loadDoc: BackfillDeps["loadDoc"];
  embed: BackfillDeps["embed"];
}): void {
  const latest = useRef(args);
  latest.current = args;
  const startedRef = useRef(false);
  const ready = args.enabled && args.wikiIds.length > 0;

  useEffect(() => {
    if (!ready || startedRef.current) return;
    let cancelled = false;
    const run = () =>
      runEmbeddingBackfill({
        wikiIds: latest.current.wikiIds,
        loadDoc: (id) => latest.current.loadDoc(id),
        embed: (id, doc) => latest.current.embed(id, doc),
        waitReady: () => waitForSidecarReady(),
        isCancelled: () => cancelled,
      }).catch((err) => console.warn("[embedding-backfill] failed", err));
    const timer = setTimeout(() => {
      if (cancelled || startedRef.current) return;
      startedRef.current = true;
      void run();
    }, BACKFILL_DELAY_MS);
    // 端末内モデルの取得が終わったら、text-only で待っていたページをその場で埋める
    let stop: (() => void) | undefined;
    if (isTauri()) {
      localEmbedding
        .onModelDone(() => {
          if (!cancelled) void run();
        })
        .then((u) => {
          if (cancelled) u();
          else stop = u;
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      clearTimeout(timer);
      stop?.();
    };
  }, [ready]);
}
