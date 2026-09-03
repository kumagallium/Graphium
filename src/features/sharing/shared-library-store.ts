// 共有ライブラリの単一の入口（モジュール単位のシングルトン）
//
// なぜ作ったか:
//   Library ビュー・引用ピッカー・語彙索引・埋め込みが、それぞれ独立に
//   loadAllSharedEntries で共有ルートを全件読みしていた。読む主体が増えるほど
//   同じフォルダを何度も舐め、しかも「共有した／解除した」の反映タイミングが
//   画面ごとにバラバラになる。読みを 1 本にまとめ、変化は
//   notifySharedLibraryChanged() の通知 1 本で表す。
//
// 設計:
//   - lexicalSearch サービスと同じ作法のシングルトン（React に依存しない本体 +
//     useSyncExternalStore の薄いフック）
//   - refresh は進行中の Promise を共有して重複読みを防ぐ。読んでいる最中に
//     変化通知が来たら、終わってからもう一度だけ読み直す（取りこぼし防止）
//   - readSharedEntryBody は `id|hash` をキーに小さな LRU で本文を持つ。
//     語彙索引・埋め込み・プレビューが同じ本文を続けて読むため
//   - hash が合わなかった id は mismatched に貯める（設定の索引カードで見せる）

import { useSyncExternalStore } from "react";
import {
  LocalFolderSharedProvider,
  getSharedRoot,
  type SharedEntry,
  type SharedEntryContent,
  type SharedEntryType,
} from "../../lib/storage/shared";
import { computeSharedEntryHash } from "../../lib/storage/shared/hash";
import { isTauri } from "../../lib/platform";
import { loadAllSharedEntries, type SharedLibraryLoadResult } from "./shared-library-loader";

export type SharedLibrarySnapshot = {
  /** 読み出しに使った共有ルート（未設定 / 非デスクトップなら null） */
  root: string | null;
  /** 全 type の active エントリ（type ごとに updated_at 降順） */
  entries: SharedEntry[];
  /** type 単位の読み出しエラー */
  errors: Partial<Record<SharedEntryType, string>>;
  /** 最後に読み終えた時刻（未読なら null） */
  loadedAt: string | null;
  loading: boolean;
  /** 本文の hash が entry.hash と合わなかったエントリ id */
  mismatched: string[];
};

export type SharedLibraryLoader = (root: string) => Promise<SharedLibraryLoadResult>;
/** provider.read 相当（テストで差し替える） */
export type SharedEntryReader = (root: string, id: string) => Promise<SharedEntryContent>;

/** 本文キャッシュの上限（件）。プレビュー用の本文が数 MB になることもあるので小さく保つ */
const BODY_CACHE_LIMIT = 64;

const EMPTY: SharedLibrarySnapshot = {
  root: null,
  entries: [],
  errors: {},
  loadedAt: null,
  loading: false,
  mismatched: [],
};

/**
 * 全 SharedEntryType。satisfies で Record を要求しているので、type が増えたら
 * ここが型エラーになって気づける。
 */
const ALL_ENTRY_TYPES = Object.keys({
  note: 0,
  reference: 0,
  "data-manifest": 0,
  template: 0,
  knowledge: 0,
  report: 0,
} satisfies Record<SharedEntryType, number>) as SharedEntryType[];

/** type ごとの配列を「note → reference → data-manifest → template → knowledge → report」の順に平坦化する */
function flatten(result: SharedLibraryLoadResult): SharedEntry[] {
  return Object.values(result.entries).flat();
}

class SharedLibraryStore {
  private snapshot: SharedLibrarySnapshot = EMPTY;
  private listeners = new Set<() => void>();
  private inFlight: Promise<SharedLibrarySnapshot> | null = null;
  /** 読み出し中に来た変更通知（終わったらもう一度読む） */
  private staleWhileLoading = false;
  private loaderOverride: SharedLibraryLoader | null = null;
  private readerOverride: SharedEntryReader | null = null;
  private rootOverride: string | null | undefined = undefined;
  /** `${id}|${hash}` → 本文（LRU: Map の挿入順を使う） */
  private bodyCache = new Map<string, { body: Uint8Array; verified: boolean }>();

  getSnapshot = (): SharedLibrarySnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit(patch: Partial<SharedLibrarySnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) {
      try {
        l();
      } catch {
        /* 購読側の例外で他の購読者を止めない */
      }
    }
  }

  /**
   * 共有ルート。デスクトップ（Tauri）以外では常に null
   * （共有ストレージはローカルフォルダの読み書きが前提）。
   */
  currentRoot(): string | null {
    if (this.rootOverride !== undefined) return this.rootOverride;
    if (!isTauri()) return null;
    const root = getSharedRoot();
    return root && root.trim() ? root : null;
  }

  async refresh(): Promise<SharedLibrarySnapshot> {
    const root = this.currentRoot();
    if (!root) {
      // ルートが外れたら本文キャッシュも捨てる（別ルートの本文を返さない）
      this.bodyCache.clear();
      this.emit({ ...EMPTY, loadedAt: this.snapshot.loadedAt });
      return this.snapshot;
    }
    if (this.inFlight) return this.inFlight;
    const load = this.loaderOverride ?? loadAllSharedEntries;
    this.emit({ loading: true });
    this.inFlight = (async () => {
      try {
        const result = await load(root);
        const entries = flatten(result);
        const alive = new Set(entries.map((e) => e.id));
        this.emit({
          root,
          entries,
          errors: result.errors,
          loadedAt: new Date().toISOString(),
          loading: false,
          // 消えたエントリの不一致記録は持ち越さない
          mismatched: this.snapshot.mismatched.filter((id) => alive.has(id)),
        });
      } catch (e) {
        // ここに来るのは load(root) 自体が落ちたとき（= どの type も読めていない）。
        // loadAllSharedEntries は type ごとに try/catch するので通常は来ないが、
        // ローダー差し替えや provider の生成失敗ではあり得る。note だけの失敗として
        // 記録すると、type ごとにエラーを出す Library のタブが嘘をつくので、
        // 全 type に同じメッセージを立てる。
        const message = e instanceof Error ? e.message : String(e);
        const errors: Partial<Record<SharedEntryType, string>> = {};
        for (const type of ALL_ENTRY_TYPES) errors[type] = message;
        this.emit({ root, loading: false, errors });
      } finally {
        this.inFlight = null;
      }
      return this.snapshot;
    })();
    const done = await this.inFlight;
    // 読んでいる間に共有・共有解除が起きていたら、もう一度だけ読み直す
    if (this.staleWhileLoading) {
      this.staleWhileLoading = false;
      return this.refresh();
    }
    return done;
  }

  notifyChanged(): void {
    if (this.inFlight) {
      this.staleWhileLoading = true;
      return;
    }
    void this.refresh();
  }

  async readBody(entry: SharedEntry): Promise<{ body: Uint8Array; verified: boolean }> {
    const key = `${entry.id}|${entry.hash}`;
    const cached = this.bodyCache.get(key);
    if (cached) {
      // LRU: 触ったものを末尾へ
      this.bodyCache.delete(key);
      this.bodyCache.set(key, cached);
      return cached;
    }
    const root = this.currentRoot();
    if (!root) throw new Error("shared root is not configured");
    const read = this.readerOverride ?? ((r: string, id: string) => new LocalFolderSharedProvider(r).read(id));
    const content = await read(root, entry.id);
    // hash は「読み出したメタデータ + 本体」から計算し、こちらが持っている
    // entry.hash（索引の fingerprint に使う値）と突き合わせる。
    // 読んでいる間に上書きされた場合もここで不一致として落ちる（次の refresh で拾い直す）
    const actual = await computeSharedEntryHash(content.entry, content.body);
    const verified = actual === entry.hash;
    const value = { body: content.body, verified };
    this.bodyCache.set(key, value);
    while (this.bodyCache.size > BODY_CACHE_LIMIT) {
      const oldest = this.bodyCache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.bodyCache.delete(oldest);
    }
    this.setMismatched(entry.id, !verified);
    return value;
  }

  private setMismatched(id: string, bad: boolean): void {
    const has = this.snapshot.mismatched.includes(id);
    if (bad === has) return;
    this.emit({
      mismatched: bad ? [...this.snapshot.mismatched, id] : this.snapshot.mismatched.filter((x) => x !== id),
    });
  }

  __setForTest(
    loader: SharedLibraryLoader | null,
    options: { root?: string | null; reader?: SharedEntryReader | null } = {},
  ): void {
    this.loaderOverride = loader;
    this.readerOverride = options.reader ?? null;
    this.rootOverride = "root" in options ? options.root : undefined;
    this.inFlight = null;
    this.staleWhileLoading = false;
    this.bodyCache.clear();
    this.snapshot = EMPTY;
    this.listeners.clear();
  }
}

const store = new SharedLibraryStore();

/** 現在のスナップショット（React 外からも読める） */
export function getSharedLibrarySnapshot(): SharedLibrarySnapshot {
  return store.getSnapshot();
}

/**
 * 共有ルートを読み直す。進行中なら同じ Promise を返す（重複読み防止）。
 * ルート未設定・非デスクトップでは空スナップショットになる。
 */
export function refreshSharedLibrary(): Promise<SharedLibrarySnapshot> {
  return store.refresh();
}

export function subscribeSharedLibrary(listener: () => void): () => void {
  return store.subscribe(listener);
}

/**
 * 共有ライブラリが変わったことを知らせる（共有・共有解除・一括共有・素材共有の完了後、
 * Library の再読み込みボタン、共有ルート／スイッチの変更時）。
 * ここが唯一の通知経路で、購読側（Library・引用ピッカー・語彙索引の追従）が反応する。
 */
export function notifySharedLibraryChanged(): void {
  store.notifyChanged();
}

/**
 * エントリ本文を読む。`entry.hash` と読み出した内容の hash を突き合わせ、
 * 一致したかを verified で返す（不一致でも本文は返す — 表示はできる）。
 */
export function readSharedEntryBody(entry: SharedEntry): Promise<{ body: Uint8Array; verified: boolean }> {
  return store.readBody(entry);
}

/** 共有ルート（デスクトップかつ設定済みのときだけ非 null） */
export function getSharedLibraryRoot(): string | null {
  return store.currentRoot();
}

/** React 用。スナップショットは変化時だけ差し替わるので参照比較で足りる */
export function useSharedLibrary(): SharedLibrarySnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** type ごとに束ね直す（Library ビューのタブ用。ローダーの並び順を保つ） */
export function groupSharedEntriesByType(entries: SharedEntry[]): Record<SharedEntryType, SharedEntry[]> {
  const out: Record<SharedEntryType, SharedEntry[]> = {
    note: [],
    reference: [],
    "data-manifest": [],
    template: [],
    knowledge: [],
    report: [],
  };
  for (const e of entries) out[e.type]?.push(e);
  return out;
}

/** テスト / Storybook 用: ローダー・ルート・本文リーダーを差し替えて状態を初期化する */
export function __setSharedLibraryLoaderForTest(
  loader: SharedLibraryLoader | null,
  options: { root?: string | null; reader?: SharedEntryReader | null } = {},
): void {
  store.__setForTest(loader, options);
}
