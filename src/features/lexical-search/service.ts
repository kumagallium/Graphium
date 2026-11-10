// 語彙インデックスのサービス（シングルトン）
//
// 役割:
// - 起動時に IndexedDB のスナップショットを復元し（無ければ空から）、同期 API で検索できる状態を保つ
// - ノート / Wiki / 素材の投入・削除を受け付け、変更をデバウンスして永続化する
// - 「望ましいソース一覧」との突き合わせ（reconcile）で、足りない・古い分だけを
//   バックグラウンドで索引し、消えた分を外す。UI スレッドを塞がないよう 1 件ごとに譲る
//
// 検索は同期（`search()`）。索引が未ロードなら空配列を返すだけで、呼び出し側は
// 「まだ無い」を気にせず使える（Cmd-K の打鍵ごとに await しない）。

import {
  LexicalIndex,
  type LexicalHit,
  type LexicalSearchOptions,
  type LexicalSourceInput,
  type LexicalSourceKind,
  type LexicalSourceSummary,
  type LexicalChunkView,
  type LexicalTermStat,
} from "./lexical-index";
import { lexicalIndexStore } from "./index-store";
import { chunkNoteDocument, chunkPlainText } from "./chunk";
import type { GraphiumDocument } from "../../lib/document-types";

export type LexicalStatus = {
  state: "idle" | "loading" | "ready" | "indexing" | "error";
  /** 索引済みソース数 */
  sources: number;
  /** 索引済みチャンク数 */
  documents: number;
  /** reconcile で残っている件数（indexing 中のみ意味を持つ） */
  pending: number;
  /** 直近の reconcile で処理した件数（進捗表示用） */
  processed: number;
  lastError?: string;
  /** 最後に永続化した時刻 */
  savedAt?: string;
  /** reset のたびに増える世代番号。購読側はこれが変わったら reconcile し直す */
  generation: number;
};

export type DesiredSource = {
  kind: LexicalSourceKind;
  sourceId: string;
  fingerprint: string;
};

export type SourceLoader = (desired: DesiredSource) => Promise<LexicalSourceInput | null>;

export type ReconcileOptions = {
  /** 1 件ごとの待ち時間（ms）。リモートストレージへの連打を避けたいときに */
  delayMs?: number;
  /** 一覧に無い索引済みソースを外すか（既定 true）。部分一覧を渡すときは false */
  removeMissing?: boolean;
  /** 対象の種類（removeMissing の範囲もこれに限る）。省略で全部 */
  kinds?: LexicalSourceKind[];
};

// 変更から保存までの待ち。自動保存（3 秒）で連続して来る変更を 1 回の保存にまとめる。
// 保存は index 全体の直列化 + IndexedDB 書き込みなので、打鍵中に毎回走らせない
const SAVE_DEBOUNCE_MS = 4000;
// 変更が途切れなくても、最初の変更からこれだけ経ったら一度保存する。デバウンスだけだと、
// 数千件の索引づくり（1 件ごとに markDirty）が続く間は一度も保存されず、途中で再読み込み・
// タブが落ちると次の起動でまた最初から作り直していた。保存 1 回は索引全体の直列化
// （ナレッジ 2,000 件超で数百 MB の一時割り当て）なので、短くしすぎない
const SAVE_MAX_WAIT_MS = 60_000;
// 索引づくりの進捗（1 件ごと）を購読側へ知らせる間隔の下限。1 件ごとに知らせると、
// 購読しているアプリ本体（NoteApp）が 1 秒に数十回描き直され、数千件の索引づくりの間
// メモリを使い捨て続けた（ナレッジ 2,000 件超の Web 版でタブが落ちた原因）
const PROGRESS_NOTIFY_MS = 250;

/** アイドル時に実行（無い環境では setTimeout） */
function whenIdle(fn: () => void, timeoutMs = 3000): void {
  const ric = (globalThis as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
    .requestIdleCallback;
  if (typeof ric === "function") ric(fn, { timeout: timeoutMs });
  else setTimeout(fn, 0);
}

type Listener = (status: LexicalStatus) => void;

class LexicalSearchService {
  private index: LexicalIndex | null = null;
  private loadPromise: Promise<LexicalIndex> | null = null;
  private scopeKey = "";
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> | null = null;
  private dirty = false;
  private dirtySince: number | null = null;
  private lastNotifyAt = 0;
  private progressTimer: ReturnType<typeof setTimeout> | null = null;
  private reconcileToken = 0;
  private laneTokens = new Map<string, number>();
  private activeLanes = new Set<string>();
  private pendingByLane = new Map<string, number>();
  private listeners = new Set<Listener>();
  private status: LexicalStatus = { state: "idle", sources: 0, documents: 0, pending: 0, processed: 0, generation: 0 };

  /** 現在の状態（購読も可能） */
  getStatus(): LexicalStatus {
    return this.status;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 状態を更新してすぐ知らせる（状態の切り替わり・エラーなど） */
  private setStatus(patch: Partial<LexicalStatus>): void {
    this.applyStatus(patch);
    this.notify();
  }

  /**
   * 進捗だけの更新。状態は今すぐ書き換えるが（getStatus は最新を返す）、知らせるのは
   * PROGRESS_NOTIFY_MS に 1 回まで。間に来た更新は最後にまとめて 1 回知らせる
   */
  private setProgress(patch: Partial<LexicalStatus>): void {
    this.applyStatus(patch);
    if (this.progressTimer) return;
    const wait = this.lastNotifyAt + PROGRESS_NOTIFY_MS - Date.now();
    if (wait <= 0) {
      this.notify();
      return;
    }
    this.progressTimer = setTimeout(() => {
      this.progressTimer = null;
      this.notify();
    }, wait);
  }

  private applyStatus(patch: Partial<LexicalStatus>): void {
    this.status = {
      ...this.status,
      ...patch,
      sources: this.index?.sourceCount ?? 0,
      documents: this.index?.documentCount ?? 0,
    };
  }

  private notify(): void {
    if (this.progressTimer) {
      clearTimeout(this.progressTimer);
      this.progressTimer = null;
    }
    this.lastNotifyAt = Date.now();
    for (const l of this.listeners) {
      try {
        l(this.status);
      } catch {
        /* 購読側の例外で止めない */
      }
    }
  }

  /** 索引が同期検索できる状態か */
  isReady(): boolean {
    return this.index !== null;
  }

  /**
   * 索引をロードする（スコープが変わったら作り直す）。
   * scopeKey は「どのストレージの索引か」（provider 種別 + ルート識別子）。
   * 別スコープのスナップショットが残っていたら使わず空から始める。
   */
  ensureLoaded(scopeKey: string): Promise<LexicalIndex> {
    if (this.index && this.scopeKey === scopeKey) return Promise.resolve(this.index);
    if (this.loadPromise && this.scopeKey === scopeKey) return this.loadPromise;
    // スコープ切替: 進行中の reconcile を無効化し、未保存分は捨てる（別スコープに書かない）
    this.reconcileToken++;
    this.cancelPendingSave();
    this.index = null;
    this.scopeKey = scopeKey;
    this.setStatus({ state: "loading", pending: 0, processed: 0, lastError: undefined });
    this.loadPromise = (async () => {
      let idx: LexicalIndex | null = null;
      try {
        const stored = await lexicalIndexStore.load(scopeKey);
        if (stored) idx = await LexicalIndex.fromSnapshot(stored.snapshot);
      } catch {
        idx = null;
      }
      // ロード中にスコープが変わっていたら、この結果は捨てる
      if (this.scopeKey !== scopeKey) throw new Error("lexical index: scope changed while loading");
      this.index = idx ?? new LexicalIndex();
      this.loadPromise = null;
      this.setStatus({ state: "ready" });
      // 旧形式の保存から復元したときは、今の形式で一度書き直す（次の起動から軽くなる）
      if (this.index.needsResave) {
        this.index.needsResave = false;
        this.markDirty();
      }
      return this.index;
    })();
    this.loadPromise.catch(() => {
      this.loadPromise = null;
    });
    return this.loadPromise;
  }

  /** 同期検索。未ロードなら空 */
  search(query: string, options?: LexicalSearchOptions): LexicalHit[] {
    if (!this.index) return [];
    try {
      return this.index.search(query, options);
    } catch {
      return [];
    }
  }

  /** 索引済みソースの一覧（未ロードなら空） */
  listSources(): LexicalSourceSummary[] {
    return this.index?.listSources() ?? [];
  }

  /** ソース 1 件のチャンク一覧（本文と索引された語）。未ロードなら空 */
  listChunks(sourceId: string): LexicalChunkView[] {
    return this.index?.listChunks(sourceId) ?? [];
  }

  /** 語彙（語と断片数、df 順）。未ロードなら空 */
  vocabulary(): LexicalTermStat[] {
    return this.index?.vocabulary() ?? [];
  }

  /** ソースが同じ fingerprint で索引済みか（未ロードなら false） */
  isFresh(sourceId: string, fingerprint: string): boolean {
    return this.index?.isFresh(sourceId, fingerprint) ?? false;
  }

  hasSource(sourceId: string): boolean {
    return this.index?.hasSource(sourceId) ?? false;
  }

  /** ノート本文を索引に入れる（差し替え）。fingerprint が同じなら何もしない */
  upsertNote(noteId: string, title: string, doc: GraphiumDocument, fingerprint: string): boolean {
    return this.upsert({
      kind: "note",
      sourceId: noteId,
      title,
      chunks: chunkNoteDocument(doc),
      fingerprint,
    });
  }

  /** Wiki のセクション（embedding と同じ単位）を索引に入れる */
  upsertWiki(
    wikiId: string,
    title: string,
    sections: { sectionId: string; text: string }[],
    fingerprint: string,
  ): boolean {
    return this.upsert({
      kind: "wiki",
      sourceId: wikiId,
      title,
      chunks: sections.map((s) => ({ chunkId: s.sectionId, text: s.text })),
      fingerprint,
    });
  }

  /** 素材のテキスト（OCR / PDF 抽出 / URL 抜粋）を索引に入れる */
  upsertAsset(fileId: string, name: string, text: string, fingerprint: string): boolean {
    return this.upsert({
      kind: "asset",
      sourceId: fileId,
      title: name,
      chunks: chunkPlainText(text),
      fingerprint,
    });
  }

  /** 汎用投入 */
  upsert(input: LexicalSourceInput): boolean {
    if (!this.index) return false;
    const changed = this.index.upsertSource(input);
    if (changed) this.markDirty();
    return changed;
  }

  /** ソースを外す（ノート削除・Wiki 削除・素材削除） */
  removeSource(sourceId: string): boolean {
    if (!this.index) return false;
    const changed = this.index.removeSource(sourceId);
    if (changed) this.markDirty();
    return changed;
  }

  /**
   * 望ましいソース一覧と突き合わせ、足りない・古い分だけ loader で取り直して索引する。
   * 一覧に無い索引済みソースは外す（removeMissing）。途中で別の reconcile が始まったら止まる。
   * 戻り値は処理（索引・削除）した件数。
   */
  async reconcile(desired: DesiredSource[], loader: SourceLoader, options: ReconcileOptions = {}): Promise<number> {
    if (!this.index) return 0;
    // レーン: kinds が同じ reconcile 同士だけが互いを打ち切る（ノート系と素材系は並走できる）。
    // 全体トークン（reset / スコープ切替）はどのレーンも打ち切る
    const lane = options.kinds ? [...options.kinds].sort().join(",") : "*";
    const laneToken = (this.laneTokens.get(lane) ?? 0) + 1;
    this.laneTokens.set(lane, laneToken);
    const globalToken = this.reconcileToken;
    const idx = this.index;
    const alive = () => this.reconcileToken === globalToken && this.laneTokens.get(lane) === laneToken && this.index === idx;
    const kinds = options.kinds ? new Set(options.kinds) : null;
    const removeMissing = options.removeMissing ?? true;

    const desiredIds = new Set(desired.map((d) => d.sourceId));
    const stale = desired.filter((d) => !idx.isFresh(d.sourceId, d.fingerprint));
    const toRemove: string[] = [];
    if (removeMissing) {
      for (const id of idx.listSourceIds()) {
        const meta = idx.getSourceMeta(id);
        if (kinds && meta && !kinds.has(meta.kind)) continue;
        if (!desiredIds.has(id)) toRemove.push(id);
      }
    }

    let processed = 0;
    for (const id of toRemove) {
      if (!alive()) return processed;
      if (idx.removeSource(id)) {
        processed++;
        this.markDirty();
      }
    }

    this.activeLanes.add(lane);
    try {
      if (stale.length === 0) {
        this.setStatus({ state: this.activeLanes.size > 1 ? "indexing" : "ready", processed });
        return processed;
      }

      this.pendingByLane.set(lane, stale.length);
      this.setStatus({ state: "indexing", pending: this.totalPending(), processed: 0 });
      for (let i = 0; i < stale.length; i++) {
        if (!alive()) return processed;
        const d = stale[i];
        try {
          const input = await loader(d);
          if (!alive()) return processed;
          if (input) {
            if (idx.upsertSource({ ...input, fingerprint: d.fingerprint })) this.markDirty();
          } else {
            // 読めなかった（削除済みなど）→ 古い索引が残っていれば外す
            if (idx.removeSource(d.sourceId)) this.markDirty();
          }
        } catch (e) {
          this.setProgress({ lastError: e instanceof Error ? e.message : String(e) });
        }
        processed++;
        this.pendingByLane.set(lane, stale.length - i - 1);
        this.setProgress({ state: "indexing", pending: this.totalPending(), processed });
        // UI スレッドを塞がない。リモート連打も避ける
        await new Promise<void>((r) => setTimeout(r, options.delayMs ?? 0));
      }
      return processed;
    } finally {
      this.pendingByLane.delete(lane);
      this.activeLanes.delete(lane);
      if (this.index === idx) {
        this.setStatus({ state: this.activeLanes.size > 0 ? "indexing" : "ready", pending: this.totalPending() });
      }
    }
  }

  private totalPending(): number {
    let n = 0;
    for (const v of this.pendingByLane.values()) n += v;
    return n;
  }

  /** 進行中の reconcile を全部止める */
  cancelReconcile(): void {
    this.reconcileToken++;
  }

  /** 索引と永続化を消して空から始める（再構築の入口。呼び出し側が reconcile し直す） */
  async reset(): Promise<void> {
    this.reconcileToken++;
    this.cancelPendingSave();
    if (this.index) this.index.clear();
    else this.index = new LexicalIndex();
    try {
      await lexicalIndexStore.clear(this.scopeKey || undefined);
    } catch {
      /* 消せなくても次の save で上書きされる */
    }
    this.dirty = false;
    this.setStatus({ state: "ready", pending: 0, processed: 0, lastError: undefined, generation: this.status.generation + 1 });
  }

  /** 未保存分をいま保存する（終了前など） */
  async flush(): Promise<void> {
    this.cancelPendingSave();
    await this.saveNow();
  }

  private markDirty(): void {
    this.dirty = true;
    this.setProgress({});
    const now = Date.now();
    if (this.dirtySince === null) this.dirtySince = now;
    const waited = now - this.dirtySince;
    // 待ちの上限に達していたら、予約済みの保存をそのまま走らせる（先送りしない）
    if (this.saveTimer && waited >= SAVE_MAX_WAIT_MS) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    const delay = Math.min(SAVE_DEBOUNCE_MS, Math.max(0, SAVE_MAX_WAIT_MS - waited));
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.dirtySince = null;
      whenIdle(() => void this.saveNow());
    }, delay);
  }

  private cancelPendingSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.dirtySince = null;
  }

  private async saveNow(): Promise<void> {
    if (!this.index || !this.dirty) return;
    if (this.saving) {
      // 直前の保存が終わったらもう一度（最新のスナップショットで）
      await this.saving;
      if (!this.dirty) return;
    }
    const idx = this.index;
    const scope = this.scopeKey;
    this.dirty = false;
    this.saving = (async () => {
      try {
        // 直列化の前に discard の残骸を落としておく（スナップショットと使用メモリを小さく保つ）。
        // ここで掃除するのは、保存が whenIdle + デバウンス越しに呼ばれる＝比較的静かな
        // タイミングだから。掃除は途中で譲らないので、reconcile と並走していても壊れない。
        // 失敗しても保存は続ける — 残骸が残るだけで検索結果は正しい
        try {
          await idx.vacuumIfDirty();
        } catch (err) {
          console.warn("語彙インデックスの掃除に失敗:", err);
        }
        await lexicalIndexStore.save(idx.toSnapshot(), scope);
        this.setStatus({ savedAt: new Date().toISOString() });
      } catch (e) {
        // 保存失敗は致命ではない（キャッシュ）。次の変更で再試行する
        this.dirty = true;
        this.setStatus({ lastError: e instanceof Error ? e.message : String(e) });
      } finally {
        this.saving = null;
      }
    })();
    await this.saving;
  }

  /** テスト用: 状態を初期化する */
  __resetForTest(): void {
    this.reconcileToken++;
    this.laneTokens.clear();
    this.activeLanes.clear();
    this.pendingByLane.clear();
    this.cancelPendingSave();
    this.index = null;
    this.loadPromise = null;
    this.scopeKey = "";
    this.dirty = false;
    this.dirtySince = null;
    if (this.progressTimer) clearTimeout(this.progressTimer);
    this.progressTimer = null;
    this.lastNotifyAt = 0;
    this.saving = null;
    this.listeners.clear();
    this.status = { state: "idle", sources: 0, documents: 0, pending: 0, processed: 0, generation: 0 };
  }
}

export const lexicalSearch = new LexicalSearchService();
